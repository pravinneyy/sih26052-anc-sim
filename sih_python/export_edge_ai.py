"""
export_edge_ai.py — Export Quantized Edge AI Weights to C Header (CMSIS-NN) & JSON

Generates:
  1. `c_embedded/arm_nn_weights.h`: INT8 fixed-point quantized weight matrices and
     per-tensor quantization scales for deployment on ARM Cortex-M7 / Cortex-M55 with CMSIS-NN.
  2. `sih_python/aiml_weights.json`: JSON format for toolchain verification.
"""

import os
import json
import numpy as np
from neural_anc_model import EdgeAcousticAI

def quantize_to_int8(tensor):
    """Symmetric per-tensor INT8 quantization."""
    max_val = np.max(np.abs(tensor)) or 1.0
    scale = 127.0 / max_val
    int8_tensor = np.clip(np.round(tensor * scale), -128, 127).astype(np.int8)
    return int8_tensor, float(scale)

def export_c_header(model, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    
    W1_q, W1_scale = quantize_to_int8(model.W1)
    b1_q, b1_scale = quantize_to_int8(model.b1)
    W2_q, W2_scale = quantize_to_int8(model.W2)
    b2_q, b2_scale = quantize_to_int8(model.b2)

    with open(out_path, 'w') as f:
        f.write("/* ==========================================================================\n")
        f.write("   arm_nn_weights.h — Quantized INT8 Weights for ARM Cortex-M7 / Ethos-U55\n")
        f.write("   Generated for SIH26052 AI-Assisted Adaptive Tactical ANC & Cue Preserver\n")
        f.write("   CMSIS-NN Compatible Per-Tensor INT8 Symmetric Quantization\n")
        f.write("   ========================================================================== */\n\n")
        f.write("#ifndef ARM_NN_WEIGHTS_H\n")
        f.write("#define ARM_NN_WEIGHTS_H\n\n")
        f.write("#include <stdint.h>\n\n")
        
        f.write(f"#define AI_IN_DIM       {model.in_features}\n")
        f.write(f"#define AI_HIDDEN_DIM   {model.hidden_dim}\n")
        f.write(f"#define AI_NUM_CLASSES  {model.num_classes}\n\n")

        # Layer 1 Weights
        f.write(f"// Layer 1 Weights [{model.hidden_dim}x{model.in_features}], Scale: {W1_scale:.6f}\n")
        f.write(f"static const int8_t AI_W1[{model.hidden_dim * model.in_features}] = {{\n  ")
        f.write(", ".join(map(str, W1_q.flatten())))
        f.write("\n};\n\n")

        # Layer 1 Biases
        f.write(f"// Layer 1 Biases [{model.hidden_dim}], Scale: {b1_scale:.6f}\n")
        f.write(f"static const int8_t AI_B1[{model.hidden_dim}] = {{\n  ")
        f.write(", ".join(map(str, b1_q.flatten())))
        f.write("\n};\n\n")

        # Layer 2 Weights
        f.write(f"// Layer 2 Weights [{model.num_classes}x{model.hidden_dim}], Scale: {W2_scale:.6f}\n")
        f.write(f"static const int8_t AI_W2[{model.num_classes * model.hidden_dim}] = {{\n  ")
        f.write(", ".join(map(str, W2_q.flatten())))
        f.write("\n};\n\n")

        # Layer 2 Biases
        f.write(f"// Layer 2 Biases [{model.num_classes}], Scale: {b2_scale:.6f}\n")
        f.write(f"static const int8_t AI_B2[{model.num_classes}] = {{\n  ")
        f.write(", ".join(map(str, b2_q.flatten())))
        f.write("\n};\n\n")

        f.write(f"static const float AI_W1_SCALE = {1.0 / W1_scale:.8f}f;\n")
        f.write(f"static const float AI_W2_SCALE = {1.0 / W2_scale:.8f}f;\n\n")
        f.write("#endif // ARM_NN_WEIGHTS_H\n")

    print(f"Exported CMSIS-NN C header to: {out_path}")

def export_json(model, out_path):
    data = {
        'in_features': model.in_features,
        'hidden_dim': model.hidden_dim,
        'num_classes': model.num_classes,
        'W1': model.W1.tolist(),
        'b1': model.b1.tolist(),
        'W2': model.W2.tolist(),
        'b2': model.b2.tolist()
    }
    with open(out_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"Exported JSON model to: {out_path}")

def main():
    model = EdgeAcousticAI()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(base_dir)

    c_header_path = os.path.join(project_dir, 'c_embedded', 'arm_nn_weights.h')
    json_path = os.path.join(base_dir, 'aiml_weights.json')

    export_c_header(model, c_header_path)
    export_json(model, json_path)
    print("Edge AI Model Export complete.")

if __name__ == '__main__':
    main()
