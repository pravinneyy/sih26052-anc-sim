import kagglehub

# Download latest version
path = kagglehub.dataset_download("minsithu/audio-noise-dataset")

print("Path to dataset files:", path)