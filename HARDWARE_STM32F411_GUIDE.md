# STM32F411 Black Pill Hardware & Wiring Guide

This document provides complete physical wiring diagrams, pinout configurations, physical acoustic duct recommendations, and step-by-step flashing instructions for building a real-time Active Noise Cancellation (ANC) prototype using the **STM32F411CEU6 Black Pill**, **INMP441 I2S MEMS Microphones**, and **MAX98357A I2S Amplifier**.

---

## 1. Pin Mapping & Interfacing Diagram

The STM32F411CEU6 microcontroller uses hardware I2S peripherals to capture audio simultaneously from two INMP441 digital MEMS microphones and transmit anti-noise audio out to the MAX98357A Class-D amplifier.

### 📌 Complete Pin Table

| Component | Component Pin | STM32F411 Pin | Description / Signal |
| :--- | :--- | :--- | :--- |
| **Common Power** | 3.3V (All Mics) | **3.3V** | Main 3.3V power rail |
| | GND (All Mics & Amp) | **GND** | Shared common ground rail |
| | VIN (MAX98357A Amp) | **5V / VBUS** | 5V power supply for speaker amp |
| **INMP441 Mic 1 (Ref Noise)**| VDD | 3.3V | Power (3.3V) |
| | GND | GND | Power Ground |
| | L/R | GND | Select Left channel (0V) |
| | SCK (BCLK) | **PA5** (I2S1_CK) | Shared Bit Clock |
| | WS (LRCLK) | **PA4** (I2S1_WS) | Shared Frame Clock |
| | SD (Data) | **PA7** (I2S1_SD) | Reference Audio Input |
| **INMP441 Mic 2 (Error Noise)**| VDD | 3.3V | Power (3.3V) |
| | GND | GND | Power Ground |
| | L/R | **VDD (3.3V)** | Select Right channel (3.3V) |
| | SCK (BCLK) | **PA5** (I2S1_CK) | Shared Bit Clock (Parallel with Mic 1) |
| | WS (LRCLK) | **PA4** (I2S1_WS) | Shared Frame Clock (Parallel with Mic 1) |
| | SD (Data) | **PA7** (I2S1_SD) | Error Audio Input (Interleaved R channel) |
| **MAX98357A I2S Amp** | VIN | 5V / VBUS | 5V Power for Class-D Stage |
| | GND | GND | Common Ground |
| | BCLK | **PB13** (I2S2_CK) / synced | Output Bit Clock |
| | LRC (WS) | **PB12** (I2S2_WS) / synced | Output Frame Sync |
| | DIN | **PB15** (I2S2_SD) | Anti-Noise Audio Output |
| | GAIN | GND | 12 dB Gain (Default) |
| | SD_MODE | 3.3V via 10k resistor | Channel enable (Mix L+R / 2) |
| **Speaker** | Speaker + / - | Amp OUT+ / OUT- | 3W 4Ω or 8Ω speaker |

> 💡 **Tip for INMP441 Mics**: Both INMP441 microphones share the **SAME** SCK (Clock), WS (Frame), and SD (Data) lines on I2S1! Mic 1 has `L/R` grounded (Left channel output), and Mic 2 has `L/R` tied to 3.3V (Right channel output). This allows 2-channel stereo I2S capture on a single data line!

---

## 2. Physical Acoustic Duct Setup (Crucial for Low Latency)

Because digital I2S peripherals add ~500 µs of group delay, **do not place the mics and speaker right next to each other** (like in earphones).

```
   Incoming Noise Source ---> [ Reference Mic (INMP441 #1) ]
                                      |
                                      |<----- 25 to 35 cm Acoustic Duct ----->|
                                      |                                       |
                                      V                                       V
                               [ Speaker (MAX98357A) ]              [ Error Mic (INMP441 #2) ]
                               (Anti-Noise Output)                  (Residual Noise Monitor)
```

1. **Duct Tube**: Use a PVC or acrylic pipe (inner diameter 40–50 mm, length 35–50 cm).
2. **Reference Mic**: Place at the noise entrance of the duct.
3. **Cancellation Speaker**: Mount at 25–30 cm downstream from the reference mic.
4. **Error Mic**: Place 5–10 cm downstream after the speaker to measure residual cancellation error.

---

## 3. Step-by-Step Flashing Instructions

You can flash the STM32F411 Black Pill using either an **ST-Link V2 Programmer** or directly via **USB (DFU mode)**.

### Method A: Flashing via ST-Link V2 (Recommended)

#### Hardware Connections:
* ST-Link **3.3V** -> Black Pill **3.3V**
* ST-Link **GND**  -> Black Pill **GND**
* ST-Link **SWCLK** -> Black Pill **PA14 (CLK)**
* ST-Link **SWDIO** -> Black Pill **PA13 (DIO)**

#### Software Steps:
1. Download & Install [STM32CubeProgrammer](https://www.st.com/en/development-tools/stm32cubeprog.html) or [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html).
2. Connect ST-Link to your PC USB port.
3. Open **STM32CubeProgrammer**.
4. Select **ST-LINK** on the right side and click **Connect**.
5. Click **Open File**, select your compiled `.hex` or `.bin` firmware file.
6. Click **Download** / **Start Programming**.

---

### Method B: Flashing via USB Cable (DFU Mode - No ST-Link Required!)

The STM32F411 Black Pill comes with an embedded ROM DFU bootloader built into the chip.

#### How to Put Black Pill into DFU Mode:
1. Connect the Black Pill to your PC using a **data-capable USB-C cable**.
2. Press and **hold the `BOOT0` button**.
3. Press and release the `NRST` (Reset) button while still holding `BOOT0`.
4. Release the `BOOT0` button after 1 second.
5. Windows will recognize the device as **STM32 BOOTLOADER** under Device Manager (or USB Devices).

#### Flashing via STM32CubeProgrammer DFU:
1. Open **STM32CubeProgrammer**.
2. In the right-hand panel dropdown, select **USB**.
3. Click **Refresh** to detect USB port (Port: USB1).
4. Click **Connect**.
5. Load your compiled `.bin` / `.elf` file and click **Download**.

---

## 4. Software Firmware Architecture Overview

If you develop the firmware in STM32CubeIDE or PlatformIO (C/C++):
* **CMSIS-DSP**: Use `arm_lms_norm_f32()` or write a custom FxLMS loop.
* **DMA Double-Buffering**: Configure I2S DMA in circular mode with Half-Transfer and Transfer-Complete interrupts (`HAL_I2S_RxHalfCpltCallback` / `HAL_I2S_RxCpltCallback`).
* **Processing Chunk**: Process audio blocks of 32 or 64 samples per DMA interrupt to keep latency < 1.3 ms.
