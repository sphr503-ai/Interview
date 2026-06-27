
import React, { useEffect, useState, useRef } from 'react';
import { Genre, AdventureConfig, NarratorMode } from '../types';
import { StoryScapeService } from '../services/geminiLiveService';
import { audioBufferToWav } from '../utils/audioUtils';
import Visualizer from './Visualizer';

interface StoryFilesViewProps {
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

const StoryFilesView: React.FC<StoryFilesViewProps> = ({ config, onExit, initialHistory = [] }) => {
  const [transcriptions, setTranscriptions] = useState<Array<{ role: 'user' | 'model'; text: string }>>(initialHistory);
  const [currentModelText, setCurrentModelText] = useState('');
  const [ambientVolume, setAmbientVolume] = useState(0.25);
  const [isPaused, setIsPaused] = useState(false);
  const [connectingProgress, setConnectingProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // States for timer and session management
  const [secondsRemaining, setSecondsRemaining] = useState((config.durationMinutes || 15) * 60);
  const [showDecisionGate, setShowDecisionGate] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isOutputActive, setIsOutputActive] = useState(false);
  
  const [analysers, setAnalysers] = useState<{in: AnalyserNode | null, out: AnalyserNode | null}>({in: null, out: null});
  
  const serviceRef = useRef<StoryScapeService | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let anim: number;
    const checkSignal = () => {
      if (analysers.out) {
        const data = new Uint8Array(analysers.out.frequencyBinCount);
        analysers.out.getByteFrequencyData(data);
        const volume = data.reduce((a, b) => a + b, 0) / data.length;
        setIsOutputActive(volume > 2);
      }
      anim = requestAnimationFrame(checkSignal);
    };
    checkSignal();
    return () => cancelAnimationFrame(anim);
  }, [analysers]);

  // Timer logic
  useEffect(() => {
    if (connectingProgress === 100 && !isPaused && secondsRemaining > 0) {
      timerRef.current = window.setInterval(() => {
        setSecondsRemaining(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [connectingProgress, isPaused, secondsRemaining]);

  const initService = async (advConfig: AdventureConfig) => {
    setConnectingProgress(10);
    if (serviceRef.current) await serviceRef.current.stopAdventure();
    setConnectingProgress(30);
    const service = new StoryScapeService();
    serviceRef.current = service;

    setConnectingProgress(50);
    
    const customInstruction = `You are a Celestial Chronicler for Deep Sleep meditation in ${advConfig.language}.
    TASK: Narrate a continuous, soothing, and immersive ${advConfig.genre} story about "${advConfig.topic}".
    
    STRICT RULES:
    1. DO NOT ask the user any questions. 
    2. DO NOT ask "What happens next?" or "What do you do?".
    3. KEEP NARRATING in a calm, steady, and mesmerizing pace.
    4. Focus on deep environmental descriptions, atmosphere, and a steady flow of events.
    5. This is for sleep; avoid loud sudden noises or aggressive tone changes.
    6. Speak for a long time. If you stop, wait for the next chapter command.
    
    Current Target: A deep, long-form chapter narration.`;

    service.startAdventure(advConfig, {
      onTranscriptionUpdate: (role, text, isFinal) => {
        if (role === 'model') {
          if (isFinal) {
            setTranscriptions(prev => [...prev, { role: 'model', text: currentModelText + text }]);
            setCurrentModelText('');
          } else {
            setCurrentModelText(prev => prev + text);
          }
        }
      },
      onTurnComplete: () => {
        if (secondsRemaining > 0) {
          service.sendTextChoice("Keep going. Continue the soothing narration of the chronicle without asking questions.");
        } else {
          setShowDecisionGate(true);
        }
      },
      onError: (err) => console.error(err),
      onClose: () => onExit(),
    }, transcriptions, customInstruction).then(() => {
      setConnectingProgress(100);
      setAnalysers({ in: service.inputAnalyser, out: service.outputAnalyser });
    });
  };

  useEffect(() => {
    initService(config);
    const audio = new Audio(AMBIENT_SOUNDS[config.genre]);
    audio.loop = true;
    audio.volume = ambientVolume;
    audio.play().catch(() => {});
    ambientAudioRef.current = audio;

    return () => {
      if (serviceRef.current) serviceRef.current.stopAdventure();
      if (ambientAudioRef.current) ambientAudioRef.current.pause();
    };
  }, []);

  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = isMuted ? 0 : ambientVolume;
    }
  }, [ambientVolume, isMuted]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcriptions, currentModelText]);

  const handleEndStory = async () => {
    setIsSummarizing(true);
    const generatedSummary = await StoryScapeService.generateSummary(config.genre, transcriptions);
    setSummary(generatedSummary);
    setIsSummarizing(false);
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
      link.download = `StoryScape_Archive_${config.genre}_Session.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export audio.");
    } finally {
      setIsDownloading(false);
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

  const getGenreStyles = () => {
    switch(config.genre) {
      case Genre.FANTASY: return 'from-emerald-950/40 to-black text-emerald-50 font-fantasy';
      case Genre.SCIFI: return 'from-indigo-950/40 to-black text-indigo-50 font-scifi';
      case Genre.MYSTERY: return 'from-slate-900 to-black text-slate-100';
      case Genre.HORROR: return 'from-orange-950/30 to-black text-orange-50';
      default: return 'from-neutral-900 to-black text-white';
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`min-h-screen bg-gradient-to-b ${getGenreStyles()} flex flex-col p-4 md:p-8 transition-colors duration-1000 overflow-hidden relative`}>
      <Visualizer inputAnalyser={null} outputAnalyser={analysers.out} genre={config.genre} isPaused={isPaused} />

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 z-10">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tight">{config.genre}: {config.topic}</h1>
            <div className="flex items-center gap-2 mt-0.5">
               <div className={`w-2 h-2 rounded-full ${isOutputActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
               <p className="text-[10px] opacity-60 uppercase tracking-widest">
                 {config.language} • {config.mode} • VOICE: {config.voice}
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
            <button onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }} className="opacity-70 hover:opacity-100 transition-opacity w-5 text-left">
              <i className={`fas ${isMuted || ambientVolume === 0 ? 'fa-volume-mute text-red-400' : 'fa-volume-low'}`}></i>
            </button>
            <input type="range" min="0" max="1" step="0.01" value={ambientVolume} onChange={(e) => setAmbientVolume(parseFloat(e.target.value))} onClick={e => e.stopPropagation()} className="w-24 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
          </div>

          <button onClick={(e) => { e.stopPropagation(); handleEndStory(); }} className="px-6 py-2.5 rounded-full bg-white text-black hover:bg-opacity-90 transition-all text-xs uppercase tracking-widest font-bold">Finish</button>
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
               <p className="text-xs font-black uppercase tracking-widest opacity-60">Establishing Archival Link ({config.language})...</p>
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

          {transcriptions.map((t, i) => (
            <div key={i} className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
              <div className="max-w-[90%] p-6 rounded-[2rem] bg-black/30 border border-white/5 rounded-tl-none">
                <p className="text-[10px] opacity-40 mb-2 uppercase tracking-[0.2em] font-bold">The Narrator</p>
                <p className="text-lg md:text-xl leading-relaxed font-light">{t.text}</p>
              </div>
            </div>
          ))}

          {currentModelText && (
            <div className="flex justify-start">
              <div className="max-w-[90%] p-6 rounded-[2rem] bg-black/30 rounded-tl-none animate-pulse">
                <p className="text-lg md:text-xl leading-relaxed italic opacity-70">
                  {currentModelText}
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
                 <i className="fas fa-stopwatch text-indigo-400 text-xs opacity-60"></i>
                 <div>
                  <span className="text-xs uppercase tracking-[0.2em] font-bold opacity-80 block text-indigo-400">{formatTime(secondsRemaining)} Remaining</span>
                 </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); togglePause(); }} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isPaused ? 'bg-green-500 text-white' : 'glass hover:bg-white/10'}`}>
                <i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'}`}></i>
              </button>
            </div>
          </div>

          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div 
              className={`h-full bg-emerald-500 transition-all duration-1000 ${isOutputActive ? 'animate-pulse' : ''}`}
              style={{ width: `${(secondsRemaining / ((config.durationMinutes || 15) * 60)) * 100}%` }}
            ></div>
          </div>
        </div>
      </main>

      {(summary || isSummarizing) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl overflow-y-auto">
          <div className="max-w-3xl w-full my-auto space-y-12 py-12">
            {isSummarizing ? (
              <div className="text-center space-y-8 animate-pulse">
                <div className="w-24 h-24 border-4 border-white/5 border-t-white rounded-full animate-spin mx-auto"></div>
                <h2 className="text-3xl font-black uppercase tracking-tighter">Sealing the Archive Chronology...</h2>
              </div>
            ) : (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                <div className="text-center space-y-4">
                  <span className="px-6 py-2 rounded-full glass text-[10px] font-black uppercase tracking-[0.4em] text-white/40">The Archive Ends</span>
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

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
      `}} />
    </div>
  );
};

export default StoryFilesView;
