# Creative Foraging Detection (MediaPipe)

**Full project documentation** (goals, methods, web architecture, data formats): see the repository root [**README.md**](../README.md).

**Live demo:** [GitHub Pages — creative-foraging-game-local](https://renanbazinin.github.io/creative-foraging-game-local/)

This folder contains:

| Path | Description |
|------|-------------|
| [`CreativeForaging_Source.py`](CreativeForaging_Source.py) | PsychoPy implementation |
| [`ppc3.py`](ppc3.py) | CSV logging helpers |
| [`player_detector/`](player_detector/) | Python webcam bracelet prototype ([readme](player_detector/README.md)) |
| [`web-version/`](web-version/) | React + Vite SPA — primary UI ([readme](web-version/README.md)) |

## Quick start (this folder)

### Python (PsychoPy)

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\activate
pip install psychopy pandas numpy scipy matplotlib mediapipe opencv-python
python CreativeForaging_Source.py
```

### Web

```powershell
cd web-version
npm install
npm run dev
```

Then open **http://localhost:3000** (see [`web-version/vite.config.js`](web-version/vite.config.js)).

## License

See [MIT License](../LICENSE) at the repository root. Privacy notes for the web app: [`PRIVACY.md`](../PRIVACY.md).
