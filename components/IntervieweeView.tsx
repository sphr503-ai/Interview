import React, { useEffect, useState, useRef } from 'react';
import { GeminiVoice } from '../types';
import { StoryScapeService } from '../services/geminiLiveService';
import { audioBufferToWav } from '../utils/audioUtils';
import Visualizer from './Visualizer';
import { Genre } from '../types';
import { GoogleGenAI } from '@google/genai';

interface IntervieweeViewProps {
  currentJobDescription: string;
  appliedJobDescription: string;
  answerLength: 'short' | 'detailed';
  language: string;
  voice: GeminiVoice;
  category: string;
  onExit: () => void;
  initialHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

const AMBIENT_SOUNDS = {
  office: 'https://assets.mixkit.co/sfx/preview/mixkit-coffee-shop-ambience-loop-2268.mp3',
};

const CANDIDATE_COLORS = [
  {
    bg: 'bg-indigo-600/20 border-indigo-500/30 text-indigo-100',
    header: 'text-indigo-300',
    avatarBg: 'bg-indigo-600/30 text-indigo-300',
    accent: 'indigo'
  },
  {
    bg: 'bg-emerald-600/20 border-emerald-500/30 text-emerald-100',
    header: 'text-emerald-300',
    avatarBg: 'bg-emerald-600/30 text-emerald-300',
    accent: 'emerald'
  },
  {
    bg: 'bg-amber-600/20 border-amber-500/30 text-amber-100',
    header: 'text-amber-300',
    avatarBg: 'bg-amber-600/30 text-amber-300',
    accent: 'amber'
  },
  {
    bg: 'bg-rose-600/20 border-rose-500/30 text-rose-100',
    header: 'text-rose-300',
    avatarBg: 'bg-rose-600/30 text-rose-300',
    accent: 'rose'
  },
  {
    bg: 'bg-violet-600/20 border-violet-500/30 text-violet-100',
    header: 'text-violet-300',
    avatarBg: 'bg-violet-600/30 text-violet-300',
    accent: 'violet'
  },
  {
    bg: 'bg-cyan-600/20 border-cyan-500/30 text-cyan-100',
    header: 'text-cyan-300',
    avatarBg: 'bg-cyan-600/30 text-cyan-300',
    accent: 'cyan'
  },
  {
    bg: 'bg-fuchsia-600/20 border-fuchsia-500/30 text-fuchsia-100',
    header: 'text-fuchsia-300',
    avatarBg: 'bg-fuchsia-600/30 text-fuchsia-300',
    accent: 'fuchsia'
  }
];

type InputMode = 'text' | 'mic';

const IntervieweeView: React.FC<IntervieweeViewProps> = ({
  currentJobDescription,
  appliedJobDescription,
  answerLength,
  language,
  voice,
  category,
  onExit,
  initialHistory = [],
}) => {
  const [transcriptions, setTranscriptions] = useState<Array<{ role: 'user' | 'model'; text: string; time?: string }>>(() => {
    return initialHistory.map(t => ({
      ...t,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));
  });
  const [currentModelText, setCurrentModelText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  const [textChoice, setTextChoice] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [ambientVolume, setAmbientVolume] = useState(0.1);
  const [isPaused, setIsPaused] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showInfoSidebar, setShowInfoSidebar] = useState(true);
  
  // Audio Signal Monitoring
  const [isOutputActive, setIsOutputActive] = useState(false);
  const [isInputActive, setIsInputActive] = useState(false);
  const [connectingProgress, setConnectingProgress] = useState(0);

  const [showFinishConfirmation, setShowFinishConfirmation] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<string | null>(null);
  
  const [analysers, setAnalysers] = useState<{ in: AnalyserNode | null; out: AnalyserNode | null }>({ in: null, out: null });
  
  const serviceRef = useRef<StoryScapeService | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasErrorRef = useRef(false);

  const currentModelTextRef = useRef('');
  const currentUserTextRef = useRef('');
  const inputModeRef = useRef<InputMode>('text');

  const updateModelText = (text: string) => {
    currentModelTextRef.current = text;
    setCurrentModelText(text);
  };

  const appendModelText = (chunk: string) => {
    currentModelTextRef.current += chunk;
    setCurrentModelText(currentModelTextRef.current);
  };

  const updateUserText = (text: string) => {
    currentUserTextRef.current = text;
    setCurrentUserText(text);
  };

  const appendUserText = (chunk: string) => {
    currentUserTextRef.current += chunk;
    setCurrentUserText(currentUserTextRef.current);
  };

  useEffect(() => {
    let anim: number;
    const checkSignal = () => {
      if (analysers.out) {
        const data = new Uint8Array(analysers.out.frequencyBinCount);
        analysers.out.getByteFrequencyData(data);
        const volume = data.reduce((a, b) => a + b, 0) / data.length;
        setIsOutputActive(volume > 2);
      }
      if (analysers.in && inputMode === 'mic') {
        const data = new Uint8Array(analysers.in.frequencyBinCount);
        analysers.in.getByteFrequencyData(data);
        const volume = data.reduce((a, b) => a + b, 0) / data.length;
        setIsInputActive(volume > 2);
      } else {
        setIsInputActive(false);
      }
      anim = requestAnimationFrame(checkSignal);
    };
    checkSignal();
    return () => cancelAnimationFrame(anim);
  }, [analysers, inputMode]);

  const initService = async () => {
    setConnectingProgress(10);
    if (serviceRef.current) {
      await serviceRef.current.stopAdventure();
    }
    setConnectingProgress(30);
    const service = new StoryScapeService();
    serviceRef.current = service;

    setConnectingProgress(50);

    const lengthInstruction = answerLength === 'short'
      ? 'Your responses must be realistic, highly concise, and strictly brief: between 2 and 5 lines of text when written down.'
      : 'Your responses must be realistic, detailed, comprehensive, and thorough: between 5 and 10 lines of text when written down.';

    const systemInstruction = `You are playing the role of a job Candidate (Interviewee) in a highly realistic mock interview session.
Your background and experience are defined by the following Current Job Description:
"${currentJobDescription}"

You are applying for a job with the following Applied Job Description:
"${appliedJobDescription}"

The category of this interview session is: ${category}.
The user is your Interviewer. They will ask you questions (technical, behavioral, situational, or general) to evaluate your candidacy.
You must respond as the Candidate. Stay in character at all times.
Your response length constraint:
${lengthInstruction}

Respond naturally, as a human candidate would in a live interview. Keep your tone professional, confident, polite, and realistic. Always tailor your answers to showcase how your background (Current Job Description) translates perfectly into the target role (Applied Job Description). Respond exclusively in the chosen language: ${language}.`;

    const config = {
      genre: Genre.SCIFI,
      topic: `Interview: ${category}`,
      language,
      voice,
      mode: 'Single Narrator' as any,
    };

    service.startAdventure(config, {
      onTranscriptionUpdate: (role, text, isFinal) => {
        if (role === 'model') {
          // If the candidate starts speaking, finalize any outstanding user voice transcription first
          if (currentUserTextRef.current.trim()) {
            const finalUserText = currentUserTextRef.current.trim();
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setTranscriptions(prev => [...prev, { role: 'user', text: finalUserText, time: timestamp }]);
            updateUserText('');
          }
          // Append the current streaming model chunk
          appendModelText(text);
        } else {
          // If we are in mic mode, capture the real-time user voice transcription
          if (inputModeRef.current === 'mic') {
            appendUserText(text);
          }
        }
      },
      onTurnComplete: () => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Finalize model response
        if (currentModelTextRef.current.trim()) {
          const finalModelText = currentModelTextRef.current.trim();
          setTranscriptions(prev => [...prev, { role: 'model', text: finalModelText, time: timestamp }]);
          updateModelText('');
        }

        // Finalize user voice response (just in case)
        if (currentUserTextRef.current.trim()) {
          const finalUserText = currentUserTextRef.current.trim();
          setTranscriptions(prev => [...prev, { role: 'user', text: finalUserText, time: timestamp }]);
          updateUserText('');
        }
      },
      onError: (err) => {
        console.error("Gemini Live Error:", err);
        hasErrorRef.current = true;
        setError(String(err));
      },
      onClose: () => {
        if (!hasErrorRef.current) {
          onExit();
        }
      },
    }, transcriptions, systemInstruction).then(() => {
      setConnectingProgress(100);
      setAnalysers({ in: service.inputAnalyser, out: service.outputAnalyser });
    });
  };

  useEffect(() => {
    initService();

    const audio = new Audio(AMBIENT_SOUNDS.office);
    audio.loop = true;
    audio.volume = ambientVolume;
    audio.play().catch(() => console.warn('Ambient audio requires interaction'));
    ambientAudioRef.current = audio;

    return () => {
      if (serviceRef.current) {
        serviceRef.current.stopAdventure();
      }
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.src = '';
        ambientAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    inputModeRef.current = inputMode;
    if (serviceRef.current) {
      serviceRef.current.setMicActive(inputMode === 'mic' && isSpeaking).catch(err => {
        setError('Could not enable microphone.');
        setInputMode('text');
      });
    }
  }, [inputMode, isSpeaking]);

  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = isMuted ? 0 : ambientVolume;
    }
  }, [ambientVolume, isMuted]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, currentModelText, currentUserText]);

  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textChoice.trim() || !serviceRef.current || isPaused) return;

    const choice = textChoice.trim();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTranscriptions(prev => [...prev, { role: 'user', text: choice, time: timestamp }]);
    serviceRef.current.sendTextChoice(choice);
    setTextChoice('');
  };

  const toggleInputMode = () => {
    setInputMode(prev => prev === 'text' ? 'mic' : 'text');
  };

  const handleDownloadSession = async () => {
    if (!serviceRef.current || serviceRef.current.recordedBuffers.length === 0) {
      alert('No audio recordings captured for this session yet.');
      return;
    }
    setIsDownloading(true);
    try {
      const buffers = serviceRef.current.recordedBuffers;
      const sampleRate = buffers[0].sampleRate;
      let totalLength = 0;
      buffers.forEach(b => totalLength += b.length);

      const offlineCtx = new OfflineAudioContext(1, totalLength, sampleRate);
      let offset = 0;
      buffers.forEach(buffer => {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(offset);
        offset += buffer.duration;
      });

      const finalBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(finalBuffer);
      const url = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Interviewee_Session_${category.replace(/\s+/g, '_')}.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to export audio.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFinishRequest = () => {
    if (transcriptions.length < 2) {
      onExit();
      return;
    }
    setShowFinishConfirmation(true);
  };

  const confirmFinish = async () => {
    setShowFinishConfirmation(false);
    setIsEvaluating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const transcript = transcriptions.map(t => `${t.role === 'user' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n');
      
      const prompt = `You are a professional hiring manager and interview coach. Provide an objective, structured, and insightful interview feedback report based on the transcript below.
      
Candidate's Background (Current Job): ${currentJobDescription}
Target Role (Applied Job): ${appliedJobDescription}

Interview Transcript:
${transcript}

Provide feedback for the interviewer (the user) on how they conducted the interview, and offer a short evaluation of the candidate's performance. Keep it elegant, well-spaced, highly professional, and inspiring. Add bullet points for clear readability.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
      });

      setEvaluation(response.text || 'Evaluation generated successfully.');
    } catch (err) {
      console.error(err);
      setEvaluation('Could not generate the evaluation. Thank you for completing this mock interview!');
    } finally {
      setIsEvaluating(false);
    }
  };

  const togglePause = () => {
    const newPauseState = !isPaused;
    setIsPaused(newPauseState);
    if (serviceRef.current) serviceRef.current.setPaused(newPauseState);
    if (ambientAudioRef.current) {
      if (newPauseState) ambientAudioRef.current.pause();
      else if (!isMuted) ambientAudioRef.current.play();
    }
  };

  return (
    <div className="h-screen max-h-screen bg-[#080a10] text-slate-100 flex flex-col p-2 md:p-6 transition-colors duration-1000 overflow-hidden relative">
      <Visualizer inputAnalyser={analysers.in} outputAnalyser={analysers.out} genre={Genre.SCIFI} isPaused={isPaused} />

      {/* Main Container styling: Styled like a real chat web application wrapper */}
      <main className="flex-1 min-h-0 flex max-w-7xl mx-auto w-full glass rounded-[2.5rem] overflow-hidden shadow-2xl relative border-white/10 z-10 bg-slate-950/45 backdrop-blur-xl">
        
        {/* Left/Middle Column: The Chat Window */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
          
          {/* APK Style Top Chat Header */}
          <div className="px-6 py-4 border-b border-white/5 bg-slate-950/70 flex items-center justify-between z-20">
            <div className="flex items-center gap-3 min-w-0">
              <button 
                onClick={onExit}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/5 text-slate-400 hover:text-white transition-all mr-1 md:hidden"
                title="Go Back"
              >
                <i className="fas fa-arrow-left text-sm"></i>
              </button>

              {/* Status Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white shadow-md text-sm">
                  {voice[0]}
                </div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${isOutputActive ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`}></div>
              </div>

              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white tracking-tight truncate flex items-center gap-1.5">
                  Candidate ({voice})
                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-[8px] font-bold text-indigo-400 uppercase tracking-widest border border-indigo-500/10 hidden sm:inline-block">
                    {category}
                  </span>
                </h2>
                <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                  <span>{isOutputActive ? 'Answering in real-time...' : 'Active now'}</span>
                  <span>•</span>
                  <span>{language}</span>
                </p>
              </div>
            </div>

            {/* Top Bar Actions: Sound controls, Download, Finish & Toggle info */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsMuted(!isMuted)} 
                title={isMuted ? "Unmute Ambient Noise" : "Mute Ambient Noise"}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'hover:bg-white/5 text-slate-400 hover:text-white'}`}
              >
                <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-low'} text-xs`}></i>
              </button>

              <button 
                onClick={handleDownloadSession} 
                disabled={isDownloading}
                title="Save Recorded Audio File"
                className="w-9 h-9 rounded-full hover:bg-white/5 text-slate-400 hover:text-white flex items-center justify-center transition-all disabled:opacity-40"
              >
                <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-download'} text-xs`}></i>
              </button>

              <button 
                onClick={() => setShowInfoSidebar(!showInfoSidebar)}
                title="Toggle Position Details"
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${showInfoSidebar ? 'bg-indigo-500/10 text-indigo-400' : 'hover:bg-white/5 text-slate-400 hover:text-white'}`}
              >
                <i className="fas fa-circle-info text-xs"></i>
              </button>

              <div className="h-4 w-px bg-white/10 mx-1"></div>

              <button 
                onClick={handleFinishRequest}
                className="px-4 py-1.5 rounded-full bg-white text-black hover:bg-white/90 transition-all text-[10px] uppercase tracking-widest font-bold"
              >
                Finish
              </button>

              <button 
                onClick={onExit} 
                title="Exit Interview"
                className="w-9 h-9 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all border border-red-500/15"
              >
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>
          </div>

          {/* Chat Messages Section */}
          <div 
            ref={scrollRef} 
            className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scroll-smooth custom-scrollbar relative bg-slate-950/20"
            style={{ backgroundImage: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.03), transparent 40%)' }}
          >
            {error && (
              <div className="absolute inset-0 bg-[#080a10]/98 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
                 <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 mb-4 animate-bounce">
                   <i className="fas fa-circle-exclamation text-2xl"></i>
                 </div>
                 <h3 className="text-xl font-bold text-white mb-2">Connection Blocked</h3>
                 <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-6 text-center">
                   {error.includes("apiKey") || error.includes("API key") || error.includes("403") || error.includes("400") || error.toLowerCase().includes("key") || error.toLowerCase().includes("unauthorized")
                     ? "The connection to Google Gemini was closed because the API Key is invalid, missing, or blocked. Please make sure you have added a valid GEMINI_API_KEY environment variable to your Vercel deployment."
                     : `An error occurred while connecting to the candidate model: ${error}`}
                 </p>
                 <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 max-w-md text-left text-[11px] font-mono text-slate-400 space-y-2">
                   <p className="font-semibold text-indigo-400">💡 How to Fix on Vercel:</p>
                   <ol className="list-decimal list-inside space-y-1">
                     <li>Go to your Vercel Project Dashboard</li>
                     <li>Navigate to <b>Settings</b> &gt; <b>Environment Variables</b></li>
                     <li>Add <b>GEMINI_API_KEY</b> as the Name</li>
                     <li>Paste your Google AI Studio API key as the Value</li>
                     <li>Redeploy your project for the changes to take effect!</li>
                   </ol>
                 </div>
                 <button onClick={onExit} className="px-8 py-3 bg-white text-black font-bold uppercase tracking-widest text-[10px] rounded-full hover:scale-105 transition-all">
                   Back to Home
                 </button>
              </div>
            )}

            {connectingProgress < 100 && !error && (
              <div className="absolute inset-0 bg-[#080a10]/95 backdrop-blur-md z-40 flex flex-col items-center justify-center gap-6">
                 <div className="relative">
                   <div className="w-24 h-24 border-2 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin"></div>
                   <div className="absolute inset-0 flex items-center justify-center font-bold text-lg text-white">{connectingProgress}%</div>
                 </div>
                 <div className="text-center space-y-1">
                   <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">Preparing boardroom</p>
                   <p className="text-[10px] text-slate-400 uppercase tracking-widest">Warming up candidate synthesis model</p>
                 </div>
              </div>
            )}

            {isPaused && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-30 flex items-center justify-center flex-col gap-4">
                 <p className="text-sm uppercase tracking-[0.2em] font-bold text-slate-400">Conversation Paused</p>
                 <button onClick={togglePause} className="px-6 py-2.5 bg-white text-black rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-all">Resume Interview</button>
              </div>
            )}

            {/* Chat Welcome Prompt */}
            <div className="max-w-md mx-auto text-center py-6 px-4 space-y-3 animate-in fade-in duration-700">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-indigo-400">
                <i className="fas fa-comments-dollar text-lg"></i>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-300">Mock Boardroom Session Started</p>
                <p className="text-[10px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                  Begin asking questions like a hiring interviewer. The candidate will reply according to their job profiles and selected response length.
                </p>
              </div>
            </div>

            {/* Message Bubble Feed */}
            {transcriptions.map((t, i) => {
              const isMe = t.role === 'user';
              const colorObj = CANDIDATE_COLORS[i % CANDIDATE_COLORS.length];
              const bubbleTime = t.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div 
                  key={i} 
                  className={`flex items-end gap-2.5 ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-300`}
                >
                  {/* Left profile picture for candidate */}
                  {!isMe && (
                    <div className={`w-8 h-8 rounded-full ${colorObj.avatarBg} flex-shrink-0 flex items-center justify-center font-bold text-xs select-none shadow-sm`}>
                      {voice[0]}
                    </div>
                  )}

                  <div className={`max-w-[85%] sm:max-w-[70%] flex flex-col`}>
                    <div 
                      className={`relative px-4 py-3 rounded-2xl ${
                        isMe 
                          ? 'bg-indigo-600 text-white rounded-br-none shadow-[0_4px_12px_rgba(99,102,241,0.15)] border border-indigo-500/20' 
                          : `${colorObj.bg} border border-white/5 rounded-bl-none`
                      }`}
                    >
                      {/* Optional bubble header name */}
                      <p className={`text-[9px] uppercase tracking-[0.1em] font-bold mb-1 ${isMe ? 'text-indigo-200 text-right' : `${colorObj.header} text-left`}`}>
                        {isMe ? 'You (Interviewer)' : 'Candidate'}
                      </p>

                      <p className="text-sm leading-relaxed font-normal text-slate-100 whitespace-pre-line">
                        {t.text}
                      </p>

                      {/* Chat timestamp & read status inside bubble */}
                      <div className="flex items-center justify-end gap-1 mt-1.5 select-none opacity-50">
                        <span className="text-[8px] text-white/70 font-mono">
                          {bubbleTime}
                        </span>
                        {isMe && (
                          <span className="text-indigo-200">
                            <i className="fas fa-check-double text-[9px]"></i>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right profile picture for user interviewer */}
                  {isMe && (
                    <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex-shrink-0 flex items-center justify-center font-bold text-[10px] select-none border border-white/5">
                      INT
                    </div>
                  )}
                </div>
              );
            })}

            {/* Running model stream text or user text typing */}
            {(currentModelText || currentUserText) && (
              <div className={`flex items-end gap-2.5 ${currentUserText ? 'justify-end' : 'justify-start'}`}>
                {!currentUserText && (
                  <div className={`w-8 h-8 rounded-full ${CANDIDATE_COLORS[transcriptions.length % CANDIDATE_COLORS.length].avatarBg} flex-shrink-0 flex items-center justify-center font-bold text-xs animate-pulse`}>
                    {voice[0]}
                  </div>
                )}

                <div className={`max-w-[85%] sm:max-w-[70%]`}>
                  <div 
                    className={`px-4 py-3 rounded-2xl ${
                      currentUserText 
                        ? 'bg-indigo-600/70 text-indigo-100 rounded-br-none' 
                        : `${CANDIDATE_COLORS[transcriptions.length % CANDIDATE_COLORS.length].bg} border border-white/5 rounded-tl-3xl rounded-bl-none`
                    } animate-pulse`}
                  >
                    <p className="text-sm leading-relaxed italic opacity-85">
                      {currentModelText || currentUserText}
                    </p>
                    <div className="flex items-center gap-1 mt-1 justify-start">
                      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0.3s]"></span>
                    </div>
                  </div>
                </div>

                {currentUserText && (
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex-shrink-0 flex items-center justify-center font-bold text-[10px] animate-pulse">
                    INT
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat bottom input action controls */}
          <div className="p-4 border-t border-white/5 bg-slate-950/70 z-20">
            {/* Realistic APK Style Chat Bar Inputs */}
            {inputMode === 'text' ? (
              <form onSubmit={handleTextSubmit} className="relative flex items-center gap-3">
                {/* Input Mode Toggle Button */}
                <button
                  type="button"
                  onClick={() => setInputMode('mic')}
                  title="Switch to Microphone Input"
                  className="w-11 h-11 rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all flex-shrink-0"
                >
                  <i className="fas fa-microphone text-sm"></i>
                </button>

                <div className="flex-1 relative flex items-center">
                  <input 
                    type="text" 
                    value={textChoice} 
                    onChange={(e) => setTextChoice(e.target.value)} 
                    disabled={isPaused} 
                    placeholder={isPaused ? 'Session is paused...' : 'Type a message or interview question...'} 
                    className="w-full bg-slate-900/90 border border-white/10 rounded-full pl-6 pr-6 py-3.5 outline-none text-slate-100 placeholder-slate-500 text-xs focus:border-indigo-500/50 focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500/20 transition-all disabled:opacity-40" 
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={!textChoice.trim() || isPaused} 
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                    textChoice.trim() && !isPaused 
                      ? 'bg-indigo-500 text-white hover:bg-indigo-400 hover:scale-105 shadow-md shadow-indigo-500/10' 
                      : 'bg-white/5 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <i className="fas fa-paper-plane text-xs"></i>
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-3 animate-in fade-in duration-300">
                {/* Input Mode Toggle Button */}
                <button
                  type="button"
                  onClick={() => {
                    setInputMode('text');
                    setIsSpeaking(false);
                  }}
                  title="Switch to Keyboard Input"
                  className="w-11 h-11 rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all flex-shrink-0"
                >
                  <i className="fas fa-keyboard text-sm"></i>
                </button>

                <div className="flex-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsSpeaking(true)}
                    disabled={isSpeaking}
                    className={`flex-1 py-3.5 px-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-2 ${
                      isSpeaking
                        ? 'bg-emerald-500/10 text-emerald-500/40 border border-emerald-500/5 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:scale-[1.02]'
                    }`}
                  >
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full rounded-full bg-current ${isSpeaking ? 'animate-ping' : ''}`}></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
                    </span>
                    <span>Start Speaking 🎙️</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSpeaking(false)}
                    disabled={!isSpeaking}
                    className={`flex-1 py-3.5 px-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-2 ${
                      !isSpeaking
                        ? 'bg-red-500/10 text-red-500/40 border border-red-500/5 cursor-not-allowed'
                        : 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse hover:scale-[1.02]'
                    }`}
                  >
                    <i className="fas fa-microphone-slash text-[11px]"></i>
                    <span>Stop Speaking 🛑</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Info Column: Collapsible info panels / Contact details card */}
        {showInfoSidebar && (
          <div className="w-80 border-l border-white/5 bg-slate-950/40 flex-shrink-0 hidden lg:flex flex-col h-full overflow-hidden animate-in slide-in-from-right-4 duration-300">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-white">Interview Profile</h3>
              <button 
                onClick={() => setShowInfoSidebar(false)}
                className="text-slate-500 hover:text-white transition-colors"
                title="Hide details panel"
              >
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              
              {/* Profile Card Mock */}
              <div className="text-center space-y-3 pb-4 border-b border-white/5">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-black text-white text-3xl mx-auto shadow-xl">
                  {voice[0]}
                </div>
                <div className="space-y-0.5">
                  <h4 className="text-sm font-bold text-white">Candidate ({voice})</h4>
                  <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">{category}</p>
                </div>
              </div>

              {/* Status Checklist list */}
              <div className="space-y-3">
                <h5 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Boardroom Settings</h5>
                <div className="space-y-2.5 text-xs text-slate-300 bg-slate-900/40 border border-white/5 p-3.5 rounded-2xl">
                  <div className="flex justify-between items-center">
                    <span className="opacity-60">Accent Voice:</span>
                    <span className="font-semibold text-white">{voice}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="opacity-60">Language:</span>
                    <span className="font-semibold text-white">{language}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="opacity-60">Target Depth:</span>
                    <span className="font-semibold text-white capitalize">{answerLength}</span>
                  </div>
                </div>
              </div>

              {/* Position details fields */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <i className="fas fa-history text-[10px]"></i>
                    <h5 className="text-[9px] font-bold uppercase tracking-widest">Current Job / Background</h5>
                  </div>
                  <div className="p-3 bg-slate-900/60 border border-white/5 rounded-2xl text-xs text-slate-300 leading-relaxed italic max-h-32 overflow-y-auto custom-scrollbar">
                    "{currentJobDescription}"
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <i className="fas fa-briefcase text-[10px]"></i>
                    <h5 className="text-[9px] font-bold uppercase tracking-widest">Applied / Target Role</h5>
                  </div>
                  <div className="p-3 bg-slate-900/60 border border-white/5 rounded-2xl text-xs text-slate-300 leading-relaxed italic max-h-32 overflow-y-auto custom-scrollbar">
                    "{appliedJobDescription}"
                  </div>
                </div>
              </div>
            </div>

            {/* Footer metadata panel */}
            <div className="p-4 border-t border-white/5 bg-slate-950/60 text-center">
              <span className="text-[8px] opacity-40 uppercase tracking-widest font-mono">STORYSCAPE INTERVIEW AGENT v2.0</span>
            </div>
          </div>
        )}
      </main>

      {/* APK style finish interview details modal confirmation */}
      {showFinishConfirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
          <div className="glass p-8 rounded-[2.5rem] border-white/10 max-w-sm w-full text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
              <i className="fas fa-award text-lg"></i>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold uppercase tracking-tight text-white">End Interview Session?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Completing will end your conversation with the candidate and compile an evaluation scorecard using Gemini analysis.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button 
                onClick={confirmFinish} 
                className="w-full py-3 rounded-xl bg-white text-black font-bold uppercase tracking-widest text-[10px] hover:bg-opacity-90 transition-all"
              >
                Compile Evaluation
              </button>
              <button 
                onClick={() => setShowFinishConfirmation(false)} 
                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold uppercase tracking-widest text-[10px] hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final performance rating feedback card */}
      {(evaluation || isEvaluating) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-slate-950/95 backdrop-blur-2xl overflow-y-auto">
          <div className="max-w-2xl w-full my-auto space-y-8 py-8 animate-in fade-in duration-500">
            {isEvaluating ? (
              <div className="text-center space-y-6 py-12 animate-pulse">
                <div className="w-16 h-16 border-2 border-indigo-500/10 border-t-indigo-400 rounded-full animate-spin mx-auto"></div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold uppercase tracking-tight text-white">Analyzing performance</h2>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Generating hiring manager score report...</p>
                </div>
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
                <div className="text-center space-y-2">
                  <span className="px-4 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-400">
                    Session Scorecard Report
                  </span>
                  <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white">
                    EVALUATION
                  </h2>
                </div>

                <div className="glass p-6 md:p-10 rounded-[2.5rem] border-white/10 space-y-6 relative max-h-[55vh] overflow-y-auto custom-scrollbar bg-slate-950/40">
                  <div className="text-xs md:text-sm leading-relaxed text-slate-200 whitespace-pre-line text-left prose prose-invert">
                    {evaluation}
                  </div>
                </div>

                <div className="flex justify-center">
                  <button 
                    onClick={onExit} 
                    className="px-10 py-4 rounded-full bg-white text-black font-bold uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl"
                  >
                    Back to Selection
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IntervieweeView;
