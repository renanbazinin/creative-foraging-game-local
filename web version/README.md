# Creative Foraging Game - Web Version

A web-based implementation of the Creative Foraging Game with integrated bracelet detection using MediaPipe.

## Features

- **Creative Block Game**: Drag and drop green blocks to create interesting figures
- **Gallery System**: Save your creations to a gallery with automatic screenshots
- **Practice & Experiment Modes**: Start with practice, then switch to timed experiment
- **Bracelet Detector**: Real-time hand tracking with red/blue color detection
- **CSV Logging**: Automatic logging of all actions with download capability
- **Local sessions (no cloud)**: Under your chosen folder, each experiment is saved as `sessions/<session-id>/session.json` plus `session.csv` (same columns as Admin CSV export). Both files update together whenever data changes. The app does not use a backend server.

## Quick Start

### Installation

```powershell
cd "path\to\Creative-Foraging-Detection-Media-Pipe\web version"
npm install
```

### Running the game

```powershell
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). **Allow the browser to access the folder** when prompted. Session files are written under `sessions/<experiment-id>/` as `session.json` and `session.csv`.

### Production build (static files only)

```powershell
npm run build
```

Deploy the `dist/` folder to any static host (e.g. GitHub Pages), or preview locally:

```powershell
npm run preview
```

Camera, MediaPipe, and folder access work best over **HTTPS** or **localhost** (not `file://`).

## Configuration

### Enable/Disable Bracelet Detector

In `src/App.jsx`, change the constant:

```javascript
// Set to false to disable bracelet detector popup
const ENABLE_DETECTOR = true;
```

## How to Play

### Start Screen
1. Enter participant ID
2. Select condition (individual/group)
3. Set experiment duration in minutes
4. Click OK to start

### Game Controls
- **Mouse**: Drag blocks to move them (only movable blocks can be dragged)
- **Gallery**: Click the white frame in top-right to save current figure
- **Practice Mode**: Blue blocks can move, green blocks cannot
- **Key 'p'**: End practice and start experiment (during practice only)
- **Key 'q'**: End experiment early and download logs

### Experiment Flow
1. Welcome message appears
2. Practice mode starts (blocks turn blue when movable)
3. Press 'p' when ready to start the experiment
4. Timer starts counting down
5. Create figures and save to gallery
6. Experiment ends when time runs out
7. CSV log automatically downloads

## Bracelet Detector

### Features
- Real-time hand tracking using MediaPipe Hands
- Detects red and blue bracelets on wrist
- Logs detection status every second
- Saves logs to localStorage
- Download logs as JSON and TXT files

### Controls
- **📥 Button**: Download detection logs
- **🗑️ Button**: Clear all logs
- **− Button**: Minimize/maximize window

### Color Detection
The detector looks for:
- **Red**: HSV range [0-10, 120-255, 70-255] and [170-180, 120-255, 70-255]
- **Blue**: HSV range [100-130, 150-255, 70-255]
- **Pixel Threshold**: 200 pixels minimum to trigger detection

### Logs
Detection logs are saved every second with:
- Timestamp (ISO format)
- Status (Red, Blue, or None)

Logs are stored in:
1. **localStorage**: `braceletDetections` key
2. **Downloaded files**: 
   - `bracelet_detections_YYYY-MM-DD.json`
   - `bracelet_detections_YYYY-MM-DD.txt`

## Game Data

### CSV Log Format
The game automatically logs all actions to CSV with columns:
- `date`: Session date/time
- `id`: Participant ID
- `condition`: individual/group
- `phase`: practice/experiment
- `type`: moveblock or "added shape to gallery"
- `time`: Elapsed time in seconds
- `unit`: Block ID (for moves)
- `end_position`: Final position after snap
- `all_positions`: All block positions
- `gallery_shape_number`: Gallery item number
- `gallery`: Raw positions saved
- `gallery_normalized`: Centered/normalized positions

### Download
CSV file downloads automatically at the end with format:
`{participantID} (YYYY-MM-DD HH-MM-SS).csv`

## Technical Details

### Built With
- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **MediaPipe Hands**: Hand tracking
- **HTML5 Canvas**: Rendering and screenshots

### Game Logic
Ported from original Python PsychoPy version:
- Contiguity checking (all blocks must stay connected)
- Neighbor detection (4-directional grid)
- Position snapping to grid
- Block movement validation
- Gallery screenshot generation

### Browser Requirements
- Modern browser with WebRTC support (Chrome, Edge, Firefox)
- Webcam access for bracelet detector
- JavaScript enabled
- localStorage enabled

## File Structure

```
web version/
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.jsx                    # Entry point
│   ├── App.jsx                     # Main app with ENABLE_DETECTOR config
│   ├── App.css
│   ├── index.css
│   ├── components/
│   │   ├── StartDialog.jsx         # Initial configuration dialog
│   │   ├── StartDialog.css
│   │   ├── GameCanvas.jsx          # Main game component
│   │   ├── GameCanvas.css
│   │   ├── BraceletDetector.jsx    # Hand tracking & color detection
│   │   └── BraceletDetector.css
│   └── utils/
│       ├── gameLogic.js            # Core game algorithms
│       └── csvLogger.js            # CSV logging utility
└── public/                         # Static assets
```

## Development

### Build for Production
```powershell
npm run build
```

Output will be in `dist/` folder.

### Preview Production Build
```powershell
npm run preview
```

Live site (GitHub Pages): [https://renanbazinin.github.io/creative-foraging-game-local/](https://renanbazinin.github.io/creative-foraging-game-local/)

### Deploy to GitHub Pages

The Vite `base` path is set to `/creative-foraging-game-local/` for the project site. In the repository **Settings → Pages**, set the source to the `gh-pages` branch (or use the flow below which publishes that branch).

From this folder (`web version`):

```powershell
npm install
npm run deploy
```

That runs `predeploy` (`vite build`) then `gh-pages -d dist`, pushing the built assets to the `gh-pages` branch. Ensure GitHub Pages uses that branch.

## Troubleshooting

### Webcam Not Working
- Grant camera permissions in browser
- Check if another app is using the camera
- Try refreshing the page
- Check browser console for errors

### Detector Not Detecting Colors
- Ensure good lighting
- Check bracelet is visible in camera
- Adjust distance from camera
- Colors must match HSV thresholds

### Blocks Not Moving
- Only blocks that can move without breaking connectivity will be movable
- In practice mode, movable blocks turn blue
- Click and drag from the block itself

### CSV Not Downloading
- Check browser download settings
- Ensure pop-ups are not blocked
- Try a different browser

## Credits

Based on the original Creative Foraging Game by Kristian Tylén (AU 2018).

Web version created: November 2025
