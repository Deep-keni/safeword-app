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
    backgroundColor: '#f8fafc',
    padding: '20px',
    boxSizing: 'border-box',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  };

  const cardStyle = {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03)',
    border: '1px solid #f1f5f9',
    padding: '40px 32px',
    boxSizing: 'border-box'
  };

  const headerLogoStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '30px',
    justifyContent: 'center'
  };

  const headingStyle = {
    fontSize: '22px',
    fontWeight: '700',
    color: '#0f172a',
    margin: 0,
    letterSpacing: '-0.02em'
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
    border: focusedField === fieldName ? '2px solid #3b82f6' : '1px solid #cbd5e1',
    backgroundColor: '#f8fafc',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    boxShadow: focusedField === fieldName ? '0 0 0 3px rgba(59, 130, 246, 0.15)' : 'none'
  });

  const getRecordButtonStyle = () => ({
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: isRecording 
      ? '#ef4444' 
      : (isRecordingHovered ? '#1d4ed8' : '#2563eb'),
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    width: '100%',
    transition: 'background-color 0.2s ease, transform 0.1s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: isRecording 
      ? '0 4px 12px rgba(239, 68, 68, 0.2)' 
      : '0 4px 12px rgba(37, 99, 235, 0.15)',
    transform: isRecordingHovered ? 'translateY(-1px)' : 'none'
  });

  // Setup Screen
  if (!isSetupComplete) {
    return (
      <div style={pageContainerStyle}>
        <div style={cardStyle}>
          <div style={headerLogoStyle}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            <h1 style={headingStyle}>SafeWord Setup</h1>
          </div>

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

            <button
              type="submit"
              onMouseEnter={() => setIsSaveHovered(true)}
              onMouseLeave={() => setIsSaveHovered(false)}
              style={{
                padding: '12px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: 'pointer',
                backgroundColor: isSaveHovered ? '#16a34a' : '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                transition: 'background-color 0.2s ease, transform 0.1s ease',
                transform: isSaveHovered ? 'translateY(-1px)' : 'none',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.2)'
              }}
            >
              Save & Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Voice Journal Screen
  return (
    <div style={pageContainerStyle}>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0% { transform: scale(0.9); opacity: 0.6; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }
        body {
          margin: 0;
          padding: 0;
          background-color: #f8fafc;
        }
      `}} />

      <div style={{ ...cardStyle, maxWidth: '540px', display: 'flex', flexDirection: 'column', minHeight: '520px', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              <h2 style={{ ...headingStyle, fontSize: '18px' }}>SafeWord — Voice Journal</h2>
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
                transition: 'color 0.15s ease'
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button 
                  onClick={handleToggleRecording}
                  onMouseEnter={() => setIsRecordingHovered(true)}
                  onMouseLeave={() => setIsRecordingHovered(false)}
                  style={getRecordButtonStyle()}
                >
                  {isRecording ? (
                    <>
                      <span style={{ 
                        display: 'inline-block', 
                        width: '8px', 
                        height: '8px', 
                        backgroundColor: '#ffffff', 
                        borderRadius: '50%',
                        animation: 'pulse 1.5s infinite'
                      }} />
                      Stop Recording Entry
                    </>
                  ) : (
                    'Start Recording Entry'
                  )}
                </button>
                {isRecording && (
                  <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Listening...
                  </span>
                )}
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
                    height: '180px',
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
              </div>
            </div>
          )}
        </div>

        {/* Hidden Logs Viewer Section */}
        <div style={{ marginTop: '40px', borderTop: '1px solid #f1f5f9', paddingTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
