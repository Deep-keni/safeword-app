import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [isSupported, setIsSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);
  const cumulativeTranscriptRef = useRef('');
  const currentSessionTranscriptRef = useRef('');

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
      // Commit the current session's final text to cumulative transcript
      cumulativeTranscriptRef.current += currentSessionTranscriptRef.current;
      currentSessionTranscriptRef.current = '';

      // Auto-restart if we are still supposed to be recording
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
        // Ignore errors when stopping an inactive instance
      }
    };
  }, []);

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

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1>My Voice Journal</h1>
      
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
  );
}
