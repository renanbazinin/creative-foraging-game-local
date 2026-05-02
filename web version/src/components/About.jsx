import React from 'react';
import './StartDialog.css';
import './About.css';

const ACM_PAPER_URL = 'https://dl.acm.org/doi/10.1145/3765766.3765859';

function About() {
  const goBack = () => {
    window.location.hash = '';
  };

  return (
    <div className="dialog-overlay about-page">
      <div className="dialog-box dialog-box--wide about-box about-box--scroll">
        <h2 className="about-heading">About &amp; Learn more</h2>
        <p className="about-text">
          This task asks you to arrange <strong>ten connected blocks</strong> on a grid, save figures you
          like to the gallery, and complete timed sessions. Session data is stored only in the folder you
          choose in your browser—nothing is uploaded to a cloud server.
        </p>
        <p className="about-reference">
          <a href={ACM_PAPER_URL} target="_blank" rel="noopener noreferrer">
            Research reference (ACM)
          </a>
        </p>

        <h3 className="about-learn-title">Learn more</h3>

        <p className="about-lead">
          Player labels come from two families: <strong>live</strong> detection during the game, and{' '}
          <strong>offline</strong> re-analysis on saved camera frames in <strong>Admin → Edit moves</strong>. Live
          tracking can miss frames; the batch tools use the full snapshot and richer vision models—especially{' '}
          <strong>Identify by All All</strong>, which drives the &quot;All-All Styles Analytics (Background
          Excluded)&quot; panel.
        </p>

        <aside className="about-tip" role="note">
          <strong className="about-tip-label">Tip</strong>
          <p className="about-tip-text">
            In <strong>Edit moves</strong>, switch scan mode to <strong>Manual</strong> and define your{' '}
            <strong>scan area</strong> (draw the rectangle on a reference frame) <em>before</em> you run{' '}
            <strong>Identify by All All</strong>. That limits which pixels are analyzed—usually wrists and sleeves—so
            clustering is not dominated by unrelated background or the table. Use the same manual bounds before cloth or
            color batch passes when you want a consistent region.
          </p>
        </aside>

        <div className="about-table-wrap">
          <table className="about-methods-table">
            <caption className="about-table-caption">
              Ways this app infers <strong>who moved</strong> (Player A vs B)
            </caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">When</th>
                <th scope="col">How it works</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Live bracelet</strong>
                  <span className="about-tag">during session</span>
                </td>
                <td>While the experiment runs</td>
                <td>
                  <strong>MediaPipe Hands</strong> plus <strong>HSV</strong> color checks (red / blue bands or
                  calibrated reference colors). The game tracker samples status frequently and, at each block move,
                  picks a player using the current reading, nearby times, a ~1&nbsp;s window, or the last known
                  player. Fast, but occlusions and lighting cause gaps.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Identify by All All</strong>
                  <span className="about-tag about-tag--primary">main batch</span>
                </td>
                <td>After the session, in Edit moves (needs camera frames)</td>
                <td>
                  Uses <strong>MediaPipe Image Segmenter</strong> (multiclass model) with{' '}
                  <strong>background confidence masks</strong>: pixels that are probably background are dropped, so
                  analysis is on <strong>foreground only</strong> (&quot;background excluded&quot;). It samples
                  colors (with stride) across the frame or inside an optional <strong>manual scan area</strong>{' '}
                  (rectangle you draw once). Per-frame colors feed clustering; two dominant &quot;style&quot; clusters
                  map to Player A/B using session <strong>bracelet colors</strong> and any existing labels. The{' '}
                  <strong>BG sensitivity</strong> slider makes background filtering stricter or looser. Results appear
                  under <strong>All-All Styles Analytics (Background Excluded)</strong>, with optional swap if A/B are
                  reversed. Modes: <strong>all moves</strong> or <strong>unknown only</strong>. Prefer setting a{' '}
                  <strong>Manual</strong> scan area first (see tip above).
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Cloth-style batch</strong>
                  <span className="about-tag">👕 cloth</span>
                </td>
                <td>Edit moves, post-hoc</td>
                <td>
                  Also uses the segmenter, but focuses on the <strong>cloth / apparel</strong> class in the category
                  mask (not the same as &quot;all non-background&quot;). Clusters frames into styles and assigns A/B.
                  Same optional <strong>manual scan area</strong> as All-All for limiting where pixels are read. Run{' '}
                  <strong>👕 Cloth (all)</strong> or <strong>👕 Cloth (unknown)</strong> in the toolbar. Results show
                  under <strong>Cloth Styles Analytics</strong>—useful as an alternative or cross-check to All-All.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Color + segmentation</strong>
                  <span className="about-tag">🎨 color</span>
                </td>
                <td>Edit moves, per move or batch</td>
                <td>
                  For each frame, tries <strong>selfie / person segmentation</strong> first to find the person
                  region, then compares colors to your <strong>Player A / B</strong> hex picks (bracelet color
                  controls). Set <strong>scan area</strong> to <em>bottom</em> or <em>top</em> with a depth percentage,
                  or <strong>Manual</strong> to draw a rectangle—those bounds also apply to All-All and cloth when Manual
                  is on. Falls back to simpler color-band logic if segmentation fails. Use <strong>🎨 Color (all /
                  unknown)</strong> in the toolbar for a batch pass, or the per-move 🎨 button on each row.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Swipe View</strong>
                </td>
                <td>Edit moves</td>
                <td>
                  Manual review: step through frames and assign or confirm players when automation is uncertain.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Dropdown + swap A/B</strong>
                </td>
                <td>Edit moves</td>
                <td>
                  Each move&apos;s <strong>Player</strong> field can be set by hand. <strong>Swap A and B</strong>{' '}
                  flips every A↔B in the session file if the whole run was labeled backwards.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="about-footnote">
          In <strong>Edit moves</strong>, the toolbar runs left-to-right: All All, then cloth, then color batch passes,
          then Swipe View—plus scan-area and <strong>BG sensitivity</strong> controls (for All-All and cloth when you use
          them). Camera frames are only stored if move snapshots were enabled during the session.
        </p>

        <div className="about-actions">
          <button type="button" className="dialog-button" onClick={goBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export default About;
