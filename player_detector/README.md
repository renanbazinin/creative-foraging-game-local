# Player Bracelet Detector (Red/Blue)

**Project overview and web app architecture:** see the repository root [`README.md`](../../README.md). **License:** [`LICENSE`](../../LICENSE).

Detect the color of a wrist bracelet (red/blue/none) using a webcam feed and MediaPipe Hands. Logs the detected status once per second to both TXT and JSONL files.

## What it does
- Finds hands with MediaPipe and selects the highest hand in the frame
- Samples a wrist-centered ROI
- Classifies dominant color as:
  - `red` if red pixels > threshold
  - `blue` if blue pixels > threshold
  - `none` otherwise
- Writes logs every second to:
  - `player_detector/logs/detector_status.txt` (CSV: `timestamp,status`)
  - `player_detector/logs/detector_status.jsonl` (one JSON object per line)

## Requirements
- Python 3.10 (already set for your `.venv`)
- In your `.venv` install:
  - `mediapipe` (this installs `opencv-contrib-python` and pins NumPy appropriately)

Note: We removed `opencv-python` in this environment to avoid NumPy version conflicts with `mediapipe`. The `cv2` module is provided by `opencv-contrib-python` instead.

## How to run (Windows PowerShell)
```powershell
# From repo root
.\.venv\Scripts\Activate.ps1
python .\player_detector\bracelet_detector.py
```

Press `q` to quit.

## Optional: Camera selection
- By default the script attempts to use OBS Virtual Camera at index 1. If needed, edit `USE_OBS_CAMERA` in `bracelet_detector.py` or change `camera_index`.

## Tuning
- Use the trackbars to adjust:
  - Red/Blue saturation minimums
  - Minimum Value (brightness)
  - ROI size (px)
  - Pixel Threshold (minimum pixels to count as red/blue)

## Output files
- `player_detector/logs/detector_status.txt`
- `player_detector/logs/detector_status.jsonl`

Both are appended once per second with the latest status.
