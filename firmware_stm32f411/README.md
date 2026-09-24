# STM32F411 Real-Time FxLMS ANC Firmware

This directory contains the production-ready C/C++ firmware implementation of the **State-Gated FxLMS Active Noise Cancellation Core** specifically tuned for the **STM32F411CEU6 Black Pill** microcontroller.

---

## 📁 File Structure

* `anc_fxlms.h` — Header defining the FxLMS controller state, tap counts (128 taps), frame size (64 samples), and API.
* `anc_fxlms.c` — Implementation of the FxLMS filter, secondary path filtering, energy-ratio impulse detection, M-estimator robust weight updating, and leaky power normalization.
* `main.c` — Main entry point with I2S DMA double-buffering callbacks for INMP441 microphones and MAX98357A amplifier.

---

## 🛠️ How to Build & Flash

### Option A: STM32CubeIDE
1. Create a new **STM32 Project** targeting `STM32F411CEU6`.
2. Enable `SPI1` / `I2S1` (Half-Duplex Master Rx, DMA Circular Mode).
3. Enable `SPI2` / `I2S2` (Half-Duplex Master Tx, DMA Circular Mode).
4. Copy `anc_fxlms.h`, `anc_fxlms.c`, and `main.c` into your project `Core/Src` and `Core/Inc` folders.
5. In **Build Settings**, enable **Hard Floating Point Unit (FPU)**: `-mfloat-abi=hard -mfpu=fpv4-sp-d16`.
6. Click **Build** and **Run** (via ST-Link or DFU).

### Option B: PlatformIO (VS Code)
Add the following `platformio.ini`:

```ini
[env:blackpill_f411ce]
platform = ststm32
board = blackpill_f411ce
framework = stm32cube
build_flags = 
    -O3
    -mfloat-abi=hard
    -mfpu=fpv4-sp-d16
```
