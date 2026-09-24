/**
 * @file main.c
 * @brief STM32F411 Black Pill Main Entry & I2S DMA Audio Loop
 * 
 * SIH26052: Adaptive Noise Cancellation for Defence Environments
 */

#include "anc_fxlms.h"
#include <stdint.h>

/* I2S DMA Buffer Configuration */
#define STEREO_BUFFER_SIZE  (ANC_FRAME_SIZE * 2)   /* Left + Right interleaved */

/* Double Buffers for DMA */
static int16_t i2s1_rx_buffer[STEREO_BUFFER_SIZE * 2]; /* Input from 2x INMP441 Mics */
static int16_t i2s2_tx_buffer[STEREO_BUFFER_SIZE * 2]; /* Output to MAX98357A Amp */

/* Processing Float Buffers */
static float ref_input[ANC_FRAME_SIZE];
static float err_input[ANC_FRAME_SIZE];
static float anc_output[ANC_FRAME_SIZE];

/* Controller Instance */
static ANC_FxLMS_Controller anc_inst;

void SystemClock_Config(void);
void I2S1_Init(void);
void I2S2_Init(void);

int main(void) {
    /* Initialize System Clock @ 100 MHz */
    SystemClock_Config();
    
    /* Initialize FxLMS ANC Engine */
    ANC_FxLMS_Init(&anc_inst);
    
    /* Initialize I2S Hardware Peripherals & DMA */
    I2S1_Init();
    I2S2_Init();
    
    /* Main loop - Processing is handled inside DMA Half/Full Transfer Interrupt Callbacks */
    while (1) {
        /* Low-power sleep until next audio DMA interrupt */
        __asm volatile ("wfi");
    }
}

/**
 * @brief Process Half/Full Audio Block
 */
static void Process_Audio_Block(const int16_t *rx_buf, int16_t *tx_buf) {
    /* 1. De-interleave I2S1 RX stereo samples into floats [-1.0, 1.0] */
    for (int i = 0; i < ANC_FRAME_SIZE; i++) {
        ref_input[i] = (float)rx_buf[2 * i]     / 32768.0f; /* Left: Ref Mic */
        err_input[i] = (float)rx_buf[2 * i + 1] / 32768.0f; /* Right: Error Mic */
    }
    
    /* 2. Execute Real-Time State-Gated FxLMS ANC Engine */
    ANC_FxLMS_ProcessFrame(&anc_inst, ref_input, err_input, anc_output);
    
    /* 3. Convert ANC anti-noise output back to 16-bit PCM for MAX98357A */
    for (int i = 0; i < ANC_FRAME_SIZE; i++) {
        float val = anc_output[i] * 32767.0f;
        if (val > 32767.0f) val = 32767.0f;
        if (val < -32768.0f) val = -32768.0f;
        
        int16_t sample = (int16_t)val;
        tx_buf[2 * i]     = sample; /* Left Channel */
        tx_buf[2 * i + 1] = sample; /* Right Channel */
    }
}

/* STM32 HAL I2S DMA Half Transfer Callback */
void HAL_I2S_RxHalfCpltCallback_Custom(void) {
    Process_Audio_Block(&i2s1_rx_buffer[0], &i2s2_tx_buffer[0]);
}

/* STM32 HAL I2S DMA Transfer Complete Callback */
void HAL_I2S_RxCpltCallback_Custom(void) {
    Process_Audio_Block(&i2s1_rx_buffer[STEREO_BUFFER_SIZE], &i2s2_tx_buffer[STEREO_BUFFER_SIZE]);
}

/* Weak stubs for clock/I2S init when compiling standalone */
__attribute__((weak)) void SystemClock_Config(void) {}
__attribute__((weak)) void I2S1_Init(void) {}
__attribute__((weak)) void I2S2_Init(void) {}
