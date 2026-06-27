
import React, { useEffect, useState, useRef } from 'react';
import { Genre, GeminiVoice, AdventureConfig, NarratorMode } from '../types';
import { StoryScapeService } from '../services/geminiLiveService';
import { audioBufferToWav } from '../utils/audioUtils';
import Visualizer from './Visualizer';

interface AdventureViewProps {
  config: AdventureConfig;
  onExit: () => void;
  initialHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

const AMBIENT_SOUNDS: Record<Genre, string> = {
  [Genre.FANTASY]: 'https://assets.mixkit.co/sfx/preview/mixkit-forest-at-night-with-crickets-1224.mp3',
  [Genre.SCIFI]: 'https://assets.mixkit.co/sfx/preview/mixkit-deep-space-wind-vibe-1204.mp3',
  [Genre.MYSTERY]: 'https://assets.mixkit.co/sfx/preview/mixkit-light-rain-loop-2393.mp3',
  [Genre.HORROR]: 'https://assets.mixkit.co/sfx/preview/mixkit-horror-atmosphere-drone-953.mp3',
};

const NARRATOR_COLORS = [
  {
    bg: 'bg-indigo-950/30 border-indigo-500/30 text-indigo-100',
    header: 'text-indigo-400',
  },
  {
    bg: 'bg-emerald-950/30 border-emerald-500/30 text-emerald-100',
    header: 'text-emerald-400',
  },
  {
    bg: 'bg-amber-950/30 border-amber-500/30 text-amber-100',
    header: 'text-amber-400',
  },
  {
    bg: 'bg-rose-950/30 border-rose-500/30 text-rose-100',
    header: 'text-rose-400',
  },
  {
    bg: 'bg-violet-950/30 border-violet-500/30 text-violet-100',
    header: 'text-violet-400',
  },
  {
    bg: 'bg-cyan-950/30 border-cyan-500/30 text-cyan-100',
    header: 'text-cyan-400',
  },
  {
    bg: 'bg-fuchsia-950/30 border-fuchsia-500/30 text-fuchsia-100',
    header: 'text-fuchsia-400',
  }
];

type InputMode = 'text' | 'mic';

const AdventureView: React.FC<AdventureViewProps> = ({ config, onExit, initialHistory = [] }) => {
  const [transcriptions, setTranscriptions] = useState<Array<{ role: 'user' | 'model'; text: string }>>(initialHistory);
  const [currentModelText, setCurrentModelText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  const [textChoice, setTextChoice] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [ambientVolume, setAmbientVolume] = useState(0.25);
  const [isPaused, setIsPaused] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Audio Signal Monitoring
  const [isOutputActive, setIsOutputActive] = useState(false);
  const [isInputActive, setIsInputActive] = useState(false);
  const [connectingProgress, setConnectingProgress] = useState(0);

  const [showFinishConfirmation, setShowFinishConfirmation] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  
  const [analysers, setAnalysers] = useState<{in: AnalyserNode | null, out: AnalyserNode | null}>({in: null, out: null});
  
  const serviceRef = useRef<StoryScapeService | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const initService = async (advConfig: AdventureConfig) => {
    setConnectingProgress(10);
    if (serviceRef.current) {
      await serviceRef.current.stopAdventure();
    }
    setConnectingProgress(30);
    const service = new StoryScapeService();
    serviceRef.current = service;

    setConnectingProgress(50);
    service.startAdventure(advConfig, {
      onTranscriptionUpdate: (role, text, isFinal) => {
        if (role === 'model') {
          if (currentUserTextRef.current.trim()) {
            const finalUserText = currentUserTextRef.current.trim();
            setTranscriptions(prev => [...prev, { role: 'user', text: finalUserText }]);
            updateUserText('');
          }
          appendModelText(text);
        } else {
          if (inputModeRef.current === 'mic') {
            appendUserText(text);
          }
        }
      },
      onTurnComplete: () => {
        if (currentModelTextRef.current.trim()) {
          const finalModelText = currentModelTextRef.current.trim();
          setTranscriptions(prev => [...prev, { role: 'model', text: finalModelText }]);
          updateModelText('');
        }
        if (currentUserTextRef.current.trim()) {
          const finalUserText = currentUserTextRef.current.trim();
          setTranscriptions(prev => [...prev, { role: 'user', text: finalUserText }]);
          updateUserText('');
        }
      },
      onError: (err) => setError(String(err)),
      onClose: () => onExit(),
    }, transcriptions).then(() => {
      setConnectingProgress(100);
      setAnalysers({ in: service.inputAnalyser, out: service.outputAnalyser });
    });
  };

  useEffect(() => {
    initService(config);

    const audio = new Audio(AMBIENT_SOUNDS[config.genre]);
    audio.loop = true;
    audio.volume = ambientVolume;
    audio.play().catch(() => console.warn("Ambient audio needs interaction"));
    ambientAudioRef.current = audio;

    return () => {
      if (serviceRef.current) {
        serviceRef.current.stopAdventure();
      }
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.src = "";
        ambientAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    inputModeRef.current = inputMode;
    if (serviceRef.current) {
      serviceRef.current.setMicActive(inputMode === 'mic').catch(err => {
        setError("Could not enable microphone.");
        setInputMode('text');
      });
    }
  }, [inputMode]);

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
    setTranscriptions(prev => [...prev, { role: 'user', text: choice }]);
    serviceRef.current.sendTextChoice(choice);
    setTextChoice('');
  };

  const toggleInputMode = () => {
    setInputMode(prev => prev === 'text' ? 'mic' : 'text');
  };

  const handleDownloadSession = async () => {
    if (!serviceRef.current || serviceRef.current.recordedBuffers.length === 0) {
      alert("No audio recordings captured for this session yet.");
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
      link.download = `StoryScape_${config.genre}_Session.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export audio.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFinishAdventureRequest = () => {
    if (transcriptions.length < 2) {
      onExit();
      return;
    }
    setShowFinishConfirmation(true);
  };

  const confirmFinishAdventure = async () => {
    setShowFinishConfirmation(false);
    setIsSummarizing(true);
    const generatedSummary = await StoryScapeService.generateSummary(config.genre, transcriptions);
    setSummary(generatedSummary);
    setIsSummarizing(false);
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

  const getGenreStyles = () => {
    switch(config.genre) {
      case Genre.FANTASY: return 'from-amber-900/30 to-emerald-950/50 text-amber-50 font-fantasy';
      case Genre.SCIFI: return 'from-blue-900/30 to-indigo-950/50 text-cyan-50 font-scifi';
      case Genre.MYSTERY: return 'from-slate-800/50 to-black text-slate-200';
      case Genre.HORROR: return 'from-red-950/40 to-black text-red-100';
      default: return 'from-neutral-900 to-black text-white';
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-b ${getGenreStyles()} flex flex-col p-4 md:p-8 transition-colors duration-1000 overflow-hidden relative`} onClick={() => serviceRef.current?.setPaused(isPaused)}>
      <Visualizer inputAnalyser={analysers.in} outputAnalyser={analysers.out} genre={config.genre} isPaused={isPaused} />

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 z-10">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tight">{config.genre}: {config.topic}</h1>
            <div className="flex items-center gap-2 mt-0.5">
               <div className={`w-2 h-2 rounded-full ${isOutputActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
               <p className="text-[10px] opacity-60 uppercase tracking-widest">
                 {config.language} • {config.mode} • Voice: {config.voice}
               </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            onClick={(e) => { e.stopPropagation(); handleDownloadSession(); }} 
            disabled={isDownloading}
            className="w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-download'} text-sm`}></i>
          </button>

          <div className="flex items-center gap-3 glass px-5 py-2.5 rounded-full flex-1 md:flex-none">
            <button onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }} className="opacity-70 hover:opacity-100 transition-opacity w-5">
              <i className={`fas ${isMuted || ambientVolume === 0 ? 'fa-volume-mute text-red-400' : 'fa-volume-low'}`}></i>
            </button>
            <input type="range" min="0" max="1" step="0.01" value={ambientVolume} onChange={(e) => setAmbientVolume(parseFloat(e.target.value))} onClick={e => e.stopPropagation()} className="w-24 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
          </div>

          <button onClick={(e) => { e.stopPropagation(); handleFinishAdventureRequest(); }} className="px-6 py-2.5 rounded-full bg-white text-black hover:bg-opacity-90 transition-all text-xs uppercase tracking-widest font-bold">Finish</button>
          <button onClick={(e) => { e.stopPropagation(); onExit(); }} className="w-10 h-10 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20 flex items-center justify-center transition-all"><i className="fas fa-stop"></i></button>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full glass rounded-[2.5rem] overflow-hidden shadow-2xl relative border-white/10 z-10 bg-black/10">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-12 space-y-10 scroll-smooth custom-scrollbar relative">
          
          {connectingProgress < 100 && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-6">
               <div className="relative">
                 <div className="w-32 h-32 border-4 border-white/5 border-t-white rounded-full animate-spin"></div>
                 <div className="absolute inset-0 flex items-center justify-center font-black text-xl">{connectingProgress}%</div>
               </div>
               <p className="text-xs font-black uppercase tracking-widest opacity-60">Summoning Narrator ({config.language})...</p>
            </div>
          )}

          {isPaused && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-[30] flex items-center justify-center flex-col gap-8">
               <div className="text-center space-y-2">
                 <h2 className="text-3xl font-black tracking-[0.2em] uppercase text-white">Chronicle Paused</h2>
               </div>
               <button onClick={(e) => { e.stopPropagation(); togglePause(); }} className="px-12 py-5 bg-white text-black rounded-full font-black uppercase tracking-widest hover:scale-105 transition-all">Resume Saga</button>
            </div>
          )}

          {transcriptions.map((t, i) => {
            const colorObj = NARRATOR_COLORS[i % NARRATOR_COLORS.length];
            return (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`max-w-[80%] p-6 rounded-[2rem] ${t.role === 'user' ? 'bg-white/10 border border-white/5 rounded-tr-none' : `${colorObj.bg} border rounded-tl-none`}`}>
                  <p className={`text-[10px] uppercase tracking-[0.2em] font-black mb-2 ${t.role === 'user' ? 'text-right opacity-40 text-slate-400' : `${colorObj.header} text-left`}`}>
                    {t.role === 'user' ? 'The Wanderer' : 'The Narrator'}
                  </p>
                  <p className="text-lg md:text-xl leading-relaxed font-light">{t.text}</p>
                </div>
              </div>
            );
          })}

          {(currentModelText || currentUserText) && (
            <div className={`flex ${currentUserText ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-6 rounded-[2rem] ${currentUserText ? 'bg-white/10 rounded-tr-none' : `${NARRATOR_COLORS[transcriptions.length % NARRATOR_COLORS.length].bg} border rounded-tl-none`} animate-pulse`}>
                <p className="text-lg md:text-xl leading-relaxed italic opacity-70">
                  {currentModelText || currentUserText}
                  <span className="inline-flex gap-1 ml-3">
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0.1s]"></span>
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 glass border-t border-white/5 flex flex-col gap-4 bg-black/20">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4">
                 <div className={`w-3 h-3 rounded-full ${isOutputActive ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`}></div>
                 <div>
                  <span className="text-xs uppercase tracking-[0.2em] font-bold opacity-80 block">{isOutputActive ? 'Narrator: Speaking' : 'Narrator: Silent'}</span>
                 </div>
              </div>
              <div className="h-8 w-px bg-white/10"></div>
              <div className="flex items-center gap-4">
                 <div className={`w-3 h-3 rounded-full ${isInputActive ? 'bg-blue-500 shadow-[0_0_10px_#3b82f6]' : 'bg-white/10'}`}></div>
                 <div>
                  <span className="text-xs uppercase tracking-[0.2em] font-bold opacity-80 block">{inputMode === 'mic' ? (isInputActive ? 'Microphone: Capturing' : 'Microphone: Listening') : 'Input: Text Only'}</span>
                 </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={(e) => { e.stopPropagation(); toggleInputMode(); }} 
                className={`flex items-center gap-3 px-6 py-3 rounded-full border transition-all ${inputMode === 'mic' ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-white/5 border-white/10 text-white/40'}`}
              >
                <i className={`fas ${inputMode === 'mic' ? 'fa-microphone' : 'fa-keyboard'}`}></i>
                <span className="text-[10px] font-black uppercase tracking-widest">{inputMode === 'mic' ? 'Mic Mode' : 'Text Mode'}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); togglePause(); }} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isPaused ? 'bg-green-500 text-white' : 'glass hover:bg-white/10'}`}><i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'}`}></i></button>
            </div>
          </div>

          {inputMode === 'text' ? (
            <form onSubmit={handleTextSubmit} onClick={e => e.stopPropagation()} className="relative flex items-center gap-2">
              <input 
                type="text" 
                value={textChoice} 
                onChange={(e) => setTextChoice(e.target.value)} 
                disabled={isPaused} 
                placeholder={isPaused ? "Paused..." : "Type your command and press Enter..." } 
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none transition-all text-sm disabled:opacity-30 focus:border-white/30" 
              />
              <button type="submit" disabled={!textChoice.trim() || isPaused} className={`px-6 py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all ${textChoice.trim() && !isPaused ? 'bg-white text-black shadow-lg hover:scale-105' : 'bg-white/5 text-white/20'}`}>Send Choice</button>
            </form>
          ) : (
            <div className="flex items-center justify-center py-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl animate-pulse">
              <div className="flex flex-col items-center gap-2">
                 <div className="flex items-center gap-3">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                    <span className="text-xs font-black uppercase tracking-widest text-blue-400">Recording Choice...</span>
                 </div>
                 <p className="text-[10px] opacity-40 uppercase tracking-widest font-bold">Speak clearly, the Narrator is listening</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {showFinishConfirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-lg">
          <div className="glass p-10 rounded-[3.5rem] border-white/10 max-w-md w-full text-center space-y-8">
            <h3 className="text-2xl font-black uppercase">Finalize Story?</h3>
            <div className="flex flex-col gap-3">
              <button onClick={confirmFinishAdventure} className="w-full py-4 rounded-2xl bg-white text-black font-black uppercase tracking-widest">Begin Finalization</button>
              <button onClick={() => setShowFinishConfirmation(false)} className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 font-bold uppercase tracking-widest">Continue Saga</button>
            </div>
          </div>
        </div>
      )}

      {(summary || isSummarizing) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl overflow-y-auto">
          <div className="max-w-3xl w-full my-auto space-y-12 py-12">
            {isSummarizing ? (
              <div className="text-center space-y-8 animate-pulse">
                <div className="w-24 h-24 border-4 border-white/5 border-t-white rounded-full animate-spin mx-auto"></div>
                <h2 className="text-3xl font-black uppercase tracking-tighter">Weaving the Final Chronicle...</h2>
              </div>
            ) : (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                <div className="text-center space-y-4">
                  <span className="px-6 py-2 rounded-full glass text-[10px] font-black uppercase tracking-[0.4em] text-white/40">The End</span>
                  <h2 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-white/40">FINALE</h2>
                </div>
                <div className="glass p-12 rounded-[4rem] border-white/10 space-y-8 relative">
                  <p className="text-2xl md:text-3xl font-light italic leading-relaxed text-white/90">"{summary}"</p>
                </div>
                <div className="flex flex-col md:flex-row gap-6 justify-center pt-8">
                  <button onClick={onExit} className="px-12 py-6 rounded-[2.5rem] bg-white text-black font-black uppercase tracking-[0.2em] hover:scale-105 transition-transform shadow-2xl">Return to Sanctuary</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdventureView;
