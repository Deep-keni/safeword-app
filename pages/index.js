import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [setupData, setSetupData] = useState(null);
  const [isSetupComplete, setIsSetupComplete] = useState(false);

  const [isSupported, setIsSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [emergencyTriggered, setEmergencyTriggered] = useState(false);

  // Hidden Logs Viewer State
  const [unlockText, setUnlockText] = useState('');
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);

  // UI Interactive States (Hover/Focus)
  const [isRecordingHovered, setIsRecordingHovered] = useState(false);
  const [isResetHovered, setIsResetHovered] = useState(false);
  const [isSaveHovered, setIsSaveHovered] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);
  const cumulativeTranscriptRef = useRef('');
  const currentSessionTranscriptRef = useRef('');

  // Hydration guard and localStorage read
  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem('safeword_setup');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.codePhrase && data.emergencyCategory && data.trustedEmail) {
          setSetupData(data);
          setIsSetupComplete(true);
        }
      } catch (e) {
        console.error('Error loading setup data:', e);
      }
    }
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event) => {
      let finalSessionText = '';
      let interimSessionText = '';
      for (let i = 0; i < event.results.length; ++i) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalSessionText += text + ' ';
        } else {
          interimSessionText += text;
        }
      }
      currentSessionTranscriptRef.current = finalSessionText;

      const displayTranscript = (cumulativeTranscriptRef.current + finalSessionText + interimSessionText).trim();
      setTranscript(displayTranscript);
      console.log('Current Transcript:', displayTranscript);
    };

    rec.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
    };

    rec.onend = () => {
      cumulativeTranscriptRef.current += currentSessionTranscriptRef.current;
      currentSessionTranscriptRef.current = '';

      if (isRecordingRef.current) {
        setTimeout(() => {
          if (isRecordingRef.current) {
            try {
              rec.start();
            } catch (e) {
              console.error('Error restarting speech recognition:', e);
            }
          }
        }, 100);
      }
    };

    recognitionRef.current = rec;

    return () => {
      isRecordingRef.current = false;
      try {
        rec.stop();
      } catch (e) {
        // Ignore errors on cleanup stop
      }
    };
  }, []);

  // Debounced API Check Flow
  useEffect(() => {
    if (!isRecording || !transcript || !setupData?.codePhrase || emergencyTriggered) return;

    // Set a 2-second debounce timer
    const timer = setTimeout(() => {
      const words = transcript.trim().split(/\s+/);
      if (words.length === 0 || words[0] === "") return;
      
      // Extract the last ~15 words
      const last15Words = words.slice(-15).join(' ');
      
      checkSafeWord(last15Words);
    }, 2000);

    return () => clearTimeout(timer);
  }, [transcript, isRecording, setupData, emergencyTriggered]);

  const checkSafeWord = async (textSegment) => {
    try {
      console.log(`[Debug] Checking semantic match for: "${textSegment}" (Code Phrase: "${setupData.codePhrase}")`);
      const res = await fetch('/api/checkSafeWord', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: textSegment,
          codePhrase: setupData.codePhrase,
        }),
      });

      if (!res.ok) {
        throw new Error(`API check failed: ${res.status}`);
      }

      const data = await res.json();
      console.log(`[Debug] API Response Score: ${data.score}, Matched: ${data.matched}`);

      if (data.matched) {
        handleEmergencyTrigger(data.score, textSegment);
      }
    } catch (e) {
      console.error('Error checking safe word:', e);
    }
  };

  const handleEmergencyTrigger = (score, textSegment) => {
    if (emergencyTriggered) return; // rate limit: fire only once per session
    setEmergencyTriggered(true);

    console.log('🚨 [SILENT EMERGENCY TRIGGERED] 🚨');
    console.log(`- Match Score: ${score}`);
    console.log(`- Category: ${setupData.emergencyCategory}`);
    console.log(`- Trusted Contact: ${setupData.trustedEmail}`);

    const timestamp = new Date().toLocaleString();

    const sendAlertEmail = async (locationUrl) => {
      try {
        const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID;
        const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID;
        const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY;

        console.log('[Debug] Loading EmailJS browser SDK dynamically...');
        const emailjs = await import('@emailjs/browser');

        console.log('[Debug] Sending alert email via EmailJS...');
        await emailjs.send(
          serviceId,
          templateId,
          {
            to_email: setupData.trustedEmail,
            location_url: locationUrl || 'Location permission denied or unavailable',
            timestamp: timestamp,
            category: setupData.emergencyCategory,
            transcript: textSegment,
          },
          {
            publicKey: publicKey,
          }
        );

        // Store log entry in localStorage
        const storedLogs = localStorage.getItem('safeword_log');
        let currentLogs = [];
        if (storedLogs) {
          try {
            currentLogs = JSON.parse(storedLogs);
          } catch (e) {
            console.error('Error parsing stored logs:', e);
          }
        }
        currentLogs.push({ timestamp, category: setupData.emergencyCategory });
        localStorage.setItem('safeword_log', JSON.stringify(currentLogs));
        
        console.log('[Debug] Emergency email sent and logged successfully.');
      } catch (err) {
        console.error('EmailJS sending failed:', err);
      }
    };

    // Geolocation retrieval
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
          sendAlertEmail(mapsUrl);
        },
        (geoError) => {
          console.error('Geolocation failed or was denied:', geoError.message);
          sendAlertEmail(null);
        },
        { timeout: 10000 }
      );
    } else {
      console.error('Geolocation is not supported by this browser.');
      sendAlertEmail(null);
    }
  };

  const handleSaveSetup = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const codePhrase = formData.get('codePhrase').trim();
    const emergencyCategory = formData.get('emergencyCategory');
    const trustedEmail = formData.get('trustedEmail').trim();

    if (!codePhrase || !trustedEmail) {
      alert('Please fill out all fields.');
      return;
    }

    const data = { codePhrase, emergencyCategory, trustedEmail };
    localStorage.setItem('safeword_setup', JSON.stringify(data));
    setSetupData(data);
    setIsSetupComplete(true);
  };

  const handleResetSetup = () => {
    if (isRecording) {
      isRecordingRef.current = false;
      setIsRecording(false);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    }
    localStorage.removeItem('safeword_setup');
    setSetupData(null);
    setIsSetupComplete(false);
    setEmergencyTriggered(false);
    setTranscript('');
    cumulativeTranscriptRef.current = '';
    currentSessionTranscriptRef.current = '';
    setShowLogs(false);
    setUnlockText('');
  };

  const handleToggleRecording = () => {
    if (!recognitionRef.current) return;

    if (isRecording) {
      isRecordingRef.current = false;
      setIsRecording(false);
      recognitionRef.current.stop();
    } else {
      isRecordingRef.current = true;
      setIsRecording(true);
      cumulativeTranscriptRef.current = '';
      currentSessionTranscriptRef.current = '';
      setTranscript('');
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error('Error starting speech recognition:', e);
      }
    }
  };

  const handleUnlockChange = (e) => {
    const val = e.target.value;
    setUnlockText(val);

    if (setupData && val.trim().toLowerCase() === setupData.codePhrase.toLowerCase()) {
      const storedLogs = localStorage.getItem('safeword_log');
      if (storedLogs) {
        try {
          setLogs(JSON.parse(storedLogs));
        } catch (err) {
          console.error('Error reading logs:', err);
        }
      } else {
        setLogs([]);
      }
      setShowLogs(true);
    } else {
      setShowLogs(false);
    }
  };

  if (!isMounted) {
    return null; // Hydration guard
  }

  // Common styles
  const pageContainerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundImage: 'linear-gradient(135deg, #dbeafe 0%, #ccfbf1 100%)',
    padding: '20px',
    boxSizing: 'border-box',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  };

  const cardStyle = {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02)',
    border: '1px solid #e2e8f0',
    padding: '40px 32px',
    boxSizing: 'border-box'
  };

  const headerLogoStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
    justifyContent: 'center'
  };

  const headingStyle = {
    fontSize: '22px',
    fontWeight: '700',
    color: '#0f172a',
    margin: 0,
    letterSpacing: '-0.025em'
  };

  const labelStyle = {
    fontSize: '13px',
    fontWeight: '600',
    color: '#475569',
    marginBottom: '6px',
    display: 'block'
  };

  const getInputStyle = (fieldName) => ({
    padding: '11px 14px',
    fontSize: '14px',
    borderRadius: '8px',
    border: focusedField === fieldName ? '2px solid #0d9488' : '1px solid #cbd5e1',
    backgroundColor: '#f8fafc',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    boxShadow: focusedField === fieldName ? '0 0 0 3px rgba(13, 148, 136, 0.15)' : 'none'
  });

  const getRecordButtonStyle = () => ({
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
    background: isRecording 
      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' 
      : (isRecordingHovered 
          ? 'linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%)' 
          : 'linear-gradient(135deg, #2563eb 0%, #0d9488 100%)'),
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: isRecording 
      ? '0 4px 14px rgba(239, 68, 68, 0.25)' 
      : '0 4px 14px rgba(37, 99, 235, 0.2)',
    transform: isRecordingHovered ? 'translateY(-1px)' : 'none'
  });

  // Global stylesheet shared by both screens
  const globalStyles = (
    <style dangerouslySetInnerHTML={{__html: `
      @keyframes pulse {
        0% { transform: scale(0.9); opacity: 0.6; }
        50% { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.6; }
      }
      body {
        margin: 0;
        padding: 0;
        background: linear-gradient(135deg, #dbeafe 0%, #ccfbf1 100%) !important;
        min-height: 100vh;
      }
    `}} />
  );

  // Setup Screen
  if (!isSetupComplete) {
    return (
      <div style={pageContainerStyle}>
        {globalStyles}
        <div style={cardStyle}>
          <div style={headerLogoStyle}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 10v4" />
              <path d="M12 7v10" />
              <path d="M15 9v6" />
            </svg>
            <h1 style={headingStyle}>SafeWord Setup</h1>
          </div>
          <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', marginTop: '-5px', marginBottom: '25px', lineHeight: '1.4' }}>
            Set up your private safety trigger in under a minute.
          </p>

          <form onSubmit={handleSaveSetup} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label htmlFor="codePhrase" style={labelStyle}>Secret Code Phrase:</label>
              <input
                type="text"
                id="codePhrase"
                name="codePhrase"
                required
                onFocus={() => setFocusedField('codePhrase')}
                onBlur={() => setFocusedField(null)}
                placeholder="e.g., apple pie"
                style={getInputStyle('codePhrase')}
              />
            </div>

            <div>
              <label htmlFor="emergencyCategory" style={labelStyle}>Emergency Category:</label>
              <select
                id="emergencyCategory"
                name="emergencyCategory"
                onFocus={() => setFocusedField('emergencyCategory')}
                onBlur={() => setFocusedField(null)}
                style={getInputStyle('emergencyCategory')}
              >
                <option value="Harassment">Harassment</option>
                <option value="Kidnapping">Kidnapping</option>
                <option value="Medical">Medical</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="trustedEmail" style={labelStyle}>Trusted Contact Email:</label>
              <input
                type="email"
                id="trustedEmail"
                name="trustedEmail"
                required
                onFocus={() => setFocusedField('trustedEmail')}
                onBlur={() => setFocusedField(null)}
                placeholder="e.g., contact@example.com"
                style={getInputStyle('trustedEmail')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="submit"
                onMouseEnter={() => setIsSaveHovered(true)}
                onMouseLeave={() => setIsSaveHovered(false)}
                style={{
                  padding: '12px',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  background: isSaveHovered 
                    ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' 
                    : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  transition: 'all 0.3s ease',
                  transform: isSaveHovered ? 'translateY(-1px)' : 'none',
                  boxShadow: '0 4px 12px rgba(34, 197, 94, 0.2)'
                }}
              >
                Save & Continue
              </button>
              <p style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', margin: 0, marginTop: '2px' }}>
                Your code phrase stays private and is never shared.
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Voice Journal Screen
  return (
    <div style={pageContainerStyle}>
      {globalStyles}

      <div style={{ ...cardStyle, maxWidth: '540px', display: 'flex', flexDirection: 'column', minHeight: '530px', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 10v4" />
                  <path d="M12 7v10" />
                  <path d="M15 9v6" />
                </svg>
                <h2 style={{ ...headingStyle, fontSize: '18px' }}>SafeWord — Voice Journal</h2>
              </div>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0 34px', fontWeight: '500' }}>
                Speak naturally. Stay safe. No one will know.
              </p>
            </div>
            
            <button 
              onClick={handleResetSetup} 
              onMouseEnter={() => setIsResetHovered(true)}
              onMouseLeave={() => setIsResetHovered(false)}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: isResetHovered ? '#1d4ed8' : '#3b82f6', 
                cursor: 'pointer', 
                textDecoration: 'underline', 
                padding: 0,
                fontSize: '13px',
                fontWeight: '500',
                transition: 'color 0.15s ease',
                marginTop: '4px'
              }}
            >
              Reset Setup
            </button>
          </div>
          
          {!isSupported ? (
            <div style={{ color: '#ef4444', marginBottom: '20px', fontSize: '14px', lineHeight: '1.5', padding: '12px', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fee2e2' }}>
              Speech Recognition is not supported in this browser. Please try using Google Chrome.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <button 
                    onClick={handleToggleRecording}
                    onMouseEnter={() => setIsRecordingHovered(true)}
                    onMouseLeave={() => setIsRecordingHovered(false)}
                    style={getRecordButtonStyle()}
                  >
                    {isRecording ? 'Stop Recording Entry' : 'Start Recording Entry'}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '95px', justifyContent: 'flex-end' }}>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '8px', 
                    height: '8px', 
                    backgroundColor: isRecording ? '#10b981' : '#94a3b8', 
                    borderRadius: '50%',
                    animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                    transition: 'background-color 0.3s ease'
                  }} />
                  <span style={{ 
                    fontSize: '13px', 
                    color: isRecording ? '#10b981' : '#64748b', 
                    fontWeight: '600',
                    transition: 'color 0.3s ease'
                  }}>
                    {isRecording ? 'Listening...' : 'Idle'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="transcript-area" style={labelStyle}>Live Journal Entry Transcript:</label>
                <textarea
                  id="transcript-area"
                  value={transcript}
                  readOnly
                  placeholder="Start recording and speak. Your live transcript will show here..."
                  style={{
                    width: '100%',
                    height: '170px',
                    padding: '14px',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: '#334155',
                    backgroundColor: isRecording ? '#f8fafc' : '#ffffff',
                    border: isRecording ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                    borderRadius: '8px',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s ease, background-color 0.2s ease',
                    boxShadow: isRecording ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : 'none'
                  }}
                />
                <p style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', margin: '6px 0 0 0' }}>
                  🔒 Powered by AI semantic detection — Idea2Impact 2026
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Hidden Logs Viewer Section */}
        <div style={{ marginTop: '35px', borderTop: '1px solid #f1f5f9', paddingTop: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', cursor: 'default', fontWeight: '500' }}>Tags:</span>
            <input
              type="text"
              value={unlockText}
              onChange={handleUnlockChange}
              placeholder="journal"
              style={{
                border: 'none',
                background: '#e2e8f0',
                color: '#475569',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '12px',
                width: '75px',
                textAlign: 'center',
                outline: 'none',
                fontWeight: '500',
                transition: 'background-color 0.15s ease'
              }}
            />
          </div>

          {showLogs && (
            <div style={{ marginTop: '20px', width: '100%', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', background: '#f8fafc', textAlign: 'left', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)' }}>
              <h3 style={{ marginTop: 0, fontSize: '13px', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', color: '#0f172a', fontWeight: '700' }}>Trigger Logs</h3>
              {logs.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>No emergency events logged.</p>
              ) : (
                <ul style={{ fontSize: '12px', paddingLeft: '16px', margin: 0, color: '#334155', lineHeight: '1.6' }}>
                  {logs.map((log, idx) => (
                    <li key={idx} style={{ marginBottom: '6px' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>[{log.timestamp}]</span> Category: <span style={{ fontWeight: '600' }}>{log.category}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
