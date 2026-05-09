import React, { useState, useEffect } from 'react';
import './App.css';
import StartDialog from './components/StartDialog';
import GameCanvas from './components/GameCanvas';
import BraceletDetector from './components/BraceletDetector';
import ColorCalibration from './components/ColorCalibration';
import Summary from './components/Summary';
import BraceletDetector2 from './components/BraceletDetector2';
import Admin from './components/Admin';
import AdminUpload from './components/AdminUpload';
import MoveHistoryEditor from './components/MoveHistoryEditor';
import SwipeView from './components/SwipeView';
import About from './components/About';
import { restoreDataRootFromStorage } from './services/localSessionStore';

// ===== CONFIGURATION =====
const ENABLE_DETECTOR = true; // Set to false to disable bracelet detector
const DETECTOR_IN_NEW_WINDOW = false; // Show detector inline (no popup)
/** Hide experimenter shortcuts (Admin links, Detector2); set VITE_KIOSK_MODE=true in `.env` */
const KIOSK_MODE = import.meta.env.VITE_KIOSK_MODE === 'true';
// ===== END CONFIGURATION =====

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [gameConfig, setGameConfig] = useState(null);
  const [detectorWindow, setDetectorWindow] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(window.location.hash);
  const [interfaceHidden, setInterfaceHidden] = useState(false);

  // Restore File System Access handle when returning to the app (e.g. Admin route)
  useEffect(() => {
    restoreDataRootFromStorage().catch(() => {});
  }, []);

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Move History Editor needs document scroll; body/#root default to overflow:hidden + fixed height
  useEffect(() => {
    const isMoveEditor = /^#\/admin\/edit-moves\/.+/.test(currentRoute);
    const root = document.getElementById('root');
    if (isMoveEditor) {
      document.body.classList.add('body--documentScroll');
      root?.classList.add('root--documentScroll');
    } else {
      document.body.classList.remove('body--documentScroll');
      root?.classList.remove('root--documentScroll');
    }
    return () => {
      document.body.classList.remove('body--documentScroll');
      root?.classList.remove('root--documentScroll');
    };
  }, [currentRoute]);

  // Expose toggleInterface function globally (for game end)
  useEffect(() => {
    window.toggleInterface = (hide) => {
      setInterfaceHidden(hide);
      console.log('[App] Interface ' + (hide ? 'hidden' : 'shown'));
    };

    return () => {
      if (window.toggleInterface) {
        delete window.toggleInterface;
      }
    };
  }, []);

  const handleStartGame = (config) => {
    setGameConfig(config);
    setGameStarted(true);

    // Open detector in new window if enabled
    if (ENABLE_DETECTOR && DETECTOR_IN_NEW_WINDOW) {
      openDetectorWindow();
    }
  };

  const openDetectorWindow = () => {
    // Close existing detector window if any
    if (detectorWindow && !detectorWindow.closed) {
      detectorWindow.close();
    }

    // Use hash routing - works on any domain
    const detectorUrl = window.location.origin + window.location.pathname + '#/detector';

    // Open new popup window
    const popup = window.open(
      detectorUrl,
      'BraceletDetector',
      'width=700,height=600,left=100,top=100'
    );

    setDetectorWindow(popup);
  };

  useEffect(() => {
    // Cleanup: close detector window when main window closes
    return () => {
      if (detectorWindow && !detectorWindow.closed) {
        detectorWindow.close();
      }
    };
  }, [detectorWindow]);

  // Setup secret function to end experience
  useEffect(() => {
    // Expose secEnd function globally
    window.secEnd = () => {
      try {
        console.log('[App] secEnd() called - triggering game end');
        
        // Call the GameCanvas function to end the game properly
        if (window.endGameExperience) {
          window.endGameExperience();
        } else {
          console.warn('[App] endGameExperience() not available - game may not be running');
          alert('Game is not currently running or already ended.');
        }
      } catch (error) {
        console.error('Error ending experience:', error);
        alert('Error ending experience: ' + error.message);
      }
    };
    
    return () => {
      // Cleanup
      if (window.secEnd) {
        delete window.secEnd;
      }
    };
  }, []);

  // Route-aware rendering without early returns to keep hooks order stable
  let body = null;
  
  // Check for dynamic routes first (e.g., /admin/edit-moves/:id, /admin/swipe/:id)
  const editMovesMatch = currentRoute.match(/^#\/admin\/edit-moves\/(.+)$/);
  const swipeViewMatch = currentRoute.match(/^#\/admin\/swipe\/(.+)$/);
  
  if (currentRoute === '#/detector') {
    body = <BraceletDetector />;
  } else if (currentRoute === '#/calibrate') {
    body = <ColorCalibration />;
  } else if (currentRoute === '#/detector2') {
    body = <BraceletDetector2 />;
  } else if (currentRoute === '#/summary') {
    body = <Summary />;
  } else if (currentRoute === '#/admin') {
    body = <Admin />;
  } else if (currentRoute === '#/admin/upload') {
    body = <AdminUpload />;
  } else if (currentRoute === '#/about') {
    body = <About />;
  } else if (swipeViewMatch) {
    // SwipeView with session ID from route
    const sessionGameId = decodeURIComponent(swipeViewMatch[1]);
    body = (
      <SwipeView
        key={sessionGameId}
        sessionGameId={sessionGameId}
        onClose={() => window.location.hash = `#/admin/edit-moves/${encodeURIComponent(sessionGameId)}`}
      />
    );
  } else if (editMovesMatch) {
    // Extract the sessionGameId from the route
    const sessionGameId = decodeURIComponent(editMovesMatch[1]);
    body = <MoveHistoryEditor key={sessionGameId} sessionGameId={sessionGameId} />;
  } else {
    body = (!gameStarted ? (
      <StartDialog onStart={handleStartGame} />
    ) : (
      <>
        <GameCanvas config={gameConfig} interfaceHidden={interfaceHidden} />
        {ENABLE_DETECTOR && !DETECTOR_IN_NEW_WINDOW && (
          <BraceletDetector hidden={interfaceHidden} />
        )}
        {ENABLE_DETECTOR && DETECTOR_IN_NEW_WINDOW && gameStarted && !interfaceHidden && !KIOSK_MODE && (
          <button className="reopen-detector-btn" onClick={openDetectorWindow}>
            Open Detector Window
          </button>
        )}
        {!interfaceHidden && !KIOSK_MODE && (
          <div style={{ position:'fixed', bottom:8, right:8, display:'flex', flexDirection:'column', gap:4, zIndex:9999 }}>
              <button 
                onClick={openDetectorWindow}
                style={{ 
                  background:'#4CAF50', 
                  color:'#fff', 
                  padding:'8px 12px', 
                  borderRadius:4, 
                  fontSize:14,
                  border:'none',
                  cursor:'pointer',
                  boxShadow:'0 2px 8px rgba(0,0,0,0.3)'
                }}
                title="Open Bracelet Detector in new window"
              >
                📷 Detector
              </button>
              <a href="#/detector2" style={{ background:'#222', color:'#fff', padding:'4px 8px', borderRadius:4, fontSize:12, textDecoration:'none' }}>Detector2</a>
              <a href="#/admin" style={{ background:'#444', color:'#fff', padding:'4px 8px', borderRadius:4, fontSize:12, textDecoration:'none', textAlign:'center' }}>Admin</a>
             </div>
        )}
        {!interfaceHidden && (
          <div style={{ position:'fixed', bottom:8, left:8, zIndex:9999 }}>
            <button
              onClick={() => setInterfaceHidden(true)}
              style={{
                background:'#555',
                color:'#fff',
                padding:'8px 12px',
                borderRadius:4,
                fontSize:14,
                border:'none',
                cursor:'pointer',
                boxShadow:'0 2px 8px rgba(0,0,0,0.3)'
              }}
            >
              Hide
            </button>
          </div>
        )}
      </>
    ));
  }

  const appScrollDocument = Boolean(editMovesMatch);

  return (
    <div className={`App${appScrollDocument ? ' App--documentScroll' : ''}`}>
      {body}
    </div>
  );
}

export default App;
