/**
 * @file anc_fxlms.c
 * @brief State-Gated Robust FxLMS Core Implementation
 * 
 * SIH26052: Adaptive Noise Cancellation for Defence Environments
 */

#include "anc_fxlms.h"
#include <math.h>
#include <string.h>

void ANC_FxLMS_Init(ANC_FxLMS_Controller *ctx) {
    if (!ctx) return;
    
    memset(ctx, 0, sizeof(ANC_FxLMS_Controller));
    
    /* Default secondary path initialization (bandpass response) */
    ctx->shat[0] = 0.10f;
    ctx->shat[1] = 0.35f;
    ctx->shat[2] = 0.40f;
    ctx->shat[3] = 0.15f;
    
    ctx->pnorm = 1e-3f;
    ctx->err_med = 1e-3f;
    ctx->energy_bg = 1e-4f;
    ctx->energy_fast = 1e-4f;
}

static inline float score_m_estimator(float err, float e0) {
    float ratio = err / (e0 + 1e-9f);
    return err / (1.0f + ratio * ratio);
}

void ANC_FxLMS_ProcessFrame(ANC_FxLMS_Controller *ctx, 
                           const float *ref_in, 
                           const float *err_in, 
                           float *out) {
    if (!ctx || !ref_in || !err_in || !out) return;
    
    for (int k = 0; k < ANC_FRAME_SIZE; k++) {
        float x = ref_in[k];
        float err = err_in[k];
        
        /* 1. Shift reference delay line */
        memmove(&ctx->x_buf[1], &ctx->x_buf[0], (ANC_FILTER_TAPS - 1) * sizeof(float));
        ctx->x_buf[0] = x;
        
        /* 2. Filter reference through secondary path estimate (Shat) */
        float xf = 0.0f;
        for (int i = 0; i < ANC_SPATH_TAPS; i++) {
            xf += ctx->shat[i] * ctx->x_buf[i];
        }
        
        /* 3. Shift filtered-x delay line */
        memmove(&ctx->xf_buf[1], &ctx->xf_buf[0], (ANC_FILTER_TAPS - 1) * sizeof(float));
        ctx->xf_buf[0] = xf;
        
        /* 4. Compute anti-noise output: y = w^T * x */
        float y = 0.0f;
        for (int i = 0; i < ANC_FILTER_TAPS; i++) {
            y += ctx->w[i] * ctx->x_buf[i];
        }
        out[k] = y;
        
        /* 5. Energy-Ratio Transient Detector (Gunshot / Blast Protection) */
        float p = x * x;
        ctx->energy_fast = 0.95f * ctx->energy_fast + 0.05f * p;
        ctx->warm_samples++;
        
        if (ctx->warm_samples < 1600) {
            ctx->energy_bg += (p - ctx->energy_bg) / (float)ctx->warm_samples;
            ctx->state = 0;
        } else {
            float ratio = ctx->energy_fast / (ctx->energy_bg + 1e-9f);
            if (ratio > 4.0f) {
                ctx->state = 1;         /* Tripped by high-energy transient */
                ctx->hold_timer = 240;  /* Hold for ~15 ms */
            } else {
                ctx->energy_bg = 0.999f * ctx->energy_bg + 0.001f * p;
                if (ctx->hold_timer > 0) {
                    ctx->hold_timer--;
                    ctx->state = 2;     /* Recovery hold phase */
                } else {
                    ctx->state = 0;     /* Normal background state */
                }
            }
        }
        
        /* 6. Power Normalization & Weight Adaptation */
        ctx->err_med = 0.999f * ctx->err_med + 0.001f * fabsf(err);
        float pw = 0.0f;
        for (int i = 0; i < ANC_FILTER_TAPS; i++) {
            pw += ctx->xf_buf[i] * ctx->xf_buf[i];
        }
        ctx->pnorm = 0.9f * ctx->pnorm + 0.1f * (pw < 4.0f * ctx->pnorm ? pw : 4.0f * ctx->pnorm);
        
        float upd, m;
        if (ctx->state == 1) {
            /* Tripped: Cut step size to 0 to prevent weight explosion during blasts */
            upd = score_m_estimator(err, 2.0f * ctx->err_med);
            m = 0.0f;
        } else if (ctx->state == 2) {
            /* Holding: Controlled 40% step size recovery */
            upd = score_m_estimator(err, 2.5f * ctx->err_med);
            m = 0.40f * ANC_MU_NOMINAL;
        } else {
            /* Normal: Full adaptation with 15% efficiency boost */
            upd = err;
            m = 1.15f * ANC_MU_NOMINAL;
        }
        
        float g = m / (ctx->pnorm + 1e-6f);
        for (int i = 0; i < ANC_FILTER_TAPS; i++) {
            ctx->w[i] += g * upd * ctx->xf_buf[i];
            /* Weight saturation clamp */
            if (ctx->w[i] > 10.0f) ctx->w[i] = 10.0f;
            if (ctx->w[i] < -10.0f) ctx->w[i] = -10.0f;
        }
    }
}
