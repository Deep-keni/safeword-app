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

  // Setup Screen
  if (!isSetupComplete) {
    return (
      <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '400px', margin: '50px auto', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h2 style={{ marginTop: 0 }}>SafeWord Setup</h2>
        <form onSubmit={handleSaveSetup} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label htmlFor="codePhrase" style={{ fontWeight: 'bold' }}>Secret Code Phrase:</label>
            <input
              type="text"
              id="codePhrase"
              name="codePhrase"
              required
              placeholder="e.g. apple pie"
              style={{ padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label htmlFor="emergencyCategory" style={{ fontWeight: 'bold' }}>Emergency Category:</label>
            <select
              id="emergencyCategory"
              name="emergencyCategory"
              style={{ padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="Harassment">Harassment</option>
              <option value="Kidnapping">Kidnapping</option>
              <option value="Medical">Medical</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label htmlFor="trustedEmail" style={{ fontWeight: 'bold' }}>Trusted Contact Email:</label>
            <input
              type="email"
              id="trustedEmail"
              name="trustedEmail"
              required
              placeholder="e.g. contact@example.com"
              style={{ padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <button
            type="submit"
            style={{
              padding: '10px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: '#5cb85c',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}
          >
            Save & Continue
          </button>
        </form>
      </div>
    );
  }

  // Voice Journal Screen
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: '85vh', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>My Voice Journal</h1>
          <button 
            onClick={handleResetSetup} 
            style={{ background: 'none', border: 'none', color: '#0275d8', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            Reset Setup
          </button>
        </div>
        
        {!isSupported ? (
          <div style={{ color: 'red', marginBottom: '20px' }}>
            Speech Recognition is not supported in this browser. Please try using Google Chrome.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <button 
                onClick={handleToggleRecording}
                style={{
                  padding: '10px 20px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  backgroundColor: isRecording ? '#d9534f' : '#0275d8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px'
                }}
              >
                {isRecording ? 'Stop Recording Entry' : 'Start Recording Entry'}
              </button>
              {isRecording && <span style={{ marginLeft: '10px', color: 'green' }}>● Recording...</span>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="transcript-area" style={{ fontWeight: 'bold' }}>Transcript:</label>
              <textarea
                id="transcript-area"
                value={transcript}
                readOnly
                placeholder="Your live speech transcript will appear here..."
                style={{
                  width: '100%',
                  height: '250px',
                  padding: '10px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  resize: 'vertical'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Hidden Logs Viewer Section */}
      <div style={{ marginTop: '50px', borderTop: '1px solid #eee', paddingTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#999', cursor: 'default' }}>Tags:</span>
          <input
            type="text"
            value={unlockText}
            onChange={handleUnlockChange}
            placeholder="journal"
            style={{
              border: 'none',
              background: '#f5f5f5',
              color: '#666',
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '12px',
              width: '80px',
              textAlign: 'center',
              outline: 'none'
            }}
          />
        </div>

        {showLogs && (
          <div style={{ marginTop: '20px', width: '100%', maxWidth: '500px', border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#fafafa', textAlign: 'left' }}>
            <h3 style={{ marginTop: 0, fontSize: '14px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>Access Logs</h3>
            {logs.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>No emergency events logged yet.</p>
            ) : (
              <ul style={{ fontSize: '12px', paddingLeft: '20px', margin: 0 }}>
                {logs.map((log, idx) => (
                  <li key={idx} style={{ marginBottom: '5px' }}>
                    <strong>[{log.timestamp}]</strong> Category: {log.category}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
