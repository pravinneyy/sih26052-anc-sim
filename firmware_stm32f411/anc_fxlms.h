/**
 * @file anc_fxlms.h
 * @brief State-Gated Robust FxLMS Active Noise Cancellation Core for STM32F411
 * @target STM32F411CEU6 (ARM Cortex-M4 @ 100 MHz with FPU)
 * 
 * SIH26052: Adaptive Noise Cancellation for Defence Environments
 */

#ifndef ANC_FXLMS_H
#define ANC_FXLMS_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Configuration Parameters */
#define ANC_FILTER_TAPS     128     /* 128 taps @ 16 kHz = 8 ms impulse response */
#define ANC_SPATH_TAPS      32      /* 32 taps secondary path estimate */
#define ANC_FRAME_SIZE      64      /* DMA double buffer half-transfer chunk */
#define ANC_MU_NOMINAL      0.005f  /* Step size for adaptive weight update */

/**
 * @brief System State Structure
 */
typedef struct {
    float w[ANC_FILTER_TAPS];       /* Adaptive FIR filter weights */
    float shat[ANC_SPATH_TAPS];     /* Secondary path model estimate */
    float x_buf[ANC_FILTER_TAPS];   /* Reference input delay line */
    float xf_buf[ANC_FILTER_TAPS];  /* Filtered reference delay line */
    float y_buf[ANC_SPATH_TAPS];    /* Plant output delay line */
    
    /* Transient Detector State */
    float energy_fast;
    float energy_bg;
    float err_med;
    float pnorm;
    uint16_t hold_timer;
    uint32_t warm_samples;
    uint8_t state;                  /* 0: Normal, 1: Tripped, 2: Holding */
} ANC_FxLMS_Controller;

/**
 * @brief Initialize the FxLMS ANC Controller
 * @param ctx Pointer to ANC_FxLMS_Controller instance
 */
void ANC_FxLMS_Init(ANC_FxLMS_Controller *ctx);

/**
 * @brief Process a frame of stereo audio (Left: Ref Mic, Right: Error Mic)
 * @param ctx Pointer to controller instance
 * @param ref_in Input reference noise array [ANC_FRAME_SIZE]
 * @param err_in Input error microphone array [ANC_FRAME_SIZE]
 * @param out Output cancellation signal array [ANC_FRAME_SIZE]
 */
void ANC_FxLMS_ProcessFrame(ANC_FxLMS_Controller *ctx, 
                           const float *ref_in, 
                           const float *err_in, 
                           float *out);

#ifdef __cplusplus
}
#endif

#endif /* ANC_FXLMS_H */
