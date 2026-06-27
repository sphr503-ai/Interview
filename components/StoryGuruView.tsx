import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
import { GuruScript, StoryPart, GeminiVoice } from '../types';
import { decode, decodeAudioData, audioBufferToWav } from '../utils/audioUtils';

interface StoryGuruViewProps {
  onExit: () => void;
}

const GENRES = ['Fantasy', 'Horror', 'Cyberpunk', 'Comedy', 'Romantic', 'Action', 'Mystery', 'Space Opera'];
const LANGUAGES = [
  { id: 'English', icon: '🇺🇸' },
  { id: 'Hindi', icon: '🇮🇳' },
  { id: 'Spanish', icon: '🇪🇸' },
  { id: 'Arabic', icon: '🇦🇪' },
  { id: 'French', icon: '🇫🇷' },
  { id: 'Japanese', icon: '🇯🇵' },
];

export default function StoryGuruView({ onExit }: StoryGuruViewProps) {
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [selectedGenre, setSelectedGenre] = useState('Fantasy');
  
  const [storyTitle, setStoryTitle] = useState('New Chronicle');
  const [parts, setParts] = useState<StoryPart[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [quotaWait, setQuotaWait] = useState(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  function ensureAudioContext(): AudioContext {
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx({ sampleRate: 44100 });
    }
    return audioContextRef.current!;
  }

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  async function callWithRetry<T>(apiCall: () => Promise<T>, retryCount = 0): Promise<T> {
    try {
      return await apiCall();
    } catch (err: any) {
      const isQuotaError = err.message?.includes('429') || err.message?.toLowerCase().includes('quota');
      if (isQuotaError && retryCount < 5) {
        const waitTime = 20 + (retryCount * 10);
        setQuotaWait(waitTime);
        for (let i = waitTime; i > 0; i--) {
          setQuotaWait(i);
          await delay(1000);
        }
        setQuotaWait(0);
        return await callWithRetry<T>(apiCall, retryCount + 1);
      }
      throw err;
    }
  }

  async function handleForgePart() {
    if (!initialPrompt.trim() && parts.length === 0) return;
    
    setIsGenerating(true);
    setProgress(0);
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const partNum = parts.length + 1;
    const historySummary = parts.map(p => p.script.summary).join(' ');

    try {
      setStatus(`Director: Drafting Part ${partNum}...`);
      
      const directorPrompt = `Act as an Advanced Audio Story Director. 
      ${partNum === 1 ? `Create Part 1 of a ${selectedGenre} story in ${selectedLanguage} about: "${initialPrompt}".` : `Continue the story. PREVIOUS SUMMARY: ${historySummary}. Create Part ${partNum}.`}
      
      Requirements:
      - Use exactly 6-8 LONG segments. (Fewer segments = less quota risk)
      - Assign a speaker, voice_id (Puck, Charon, Kore, Fenrir, Zephyr), speed, and emotion.
      - Provide a concise 'summary' of this part.`;

      const scriptRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: directorPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    voice_id: { type: Type.STRING, enum: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] },
                    speed: { type: Type.STRING, enum: ['slow', 'normal', 'fast'] },
                    emotion: { type: Type.STRING }
                  },
                  required: ['speaker', 'text', 'voice_id', 'speed', 'emotion']
                }
              },
              summary: { type: Type.STRING }
            },
            required: ['title', 'segments', 'summary']
          }
        }
      }));

      const scriptText = scriptRes.text;
      if (!scriptText) throw new Error("Script generation failed: No response text.");
      const scriptData: GuruScript = JSON.parse(scriptText);
      if (partNum === 1) setStoryTitle(scriptData.title);

      const partBuffers: Record<number, AudioBuffer> = {};
      
      setStatus(`Production: Rendering Part ${partNum}...`);
      for (let i = 0; i < scriptData.segments.length; i++) {
        const seg = scriptData.segments[i];
        setStatus(`Part ${partNum} | Node ${i+1}/${scriptData.segments.length}: ${seg.speaker}...`);
        
        const ttsInstruction = `Style: ${seg.emotion}. Speed: ${seg.speed}. Content: ${seg.text}`;
        
        const b64 = await callWithRetry<string | null>(async () => {
          const res = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: ttsInstruction }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: seg.voice_id as GeminiVoice } }
              }
            }
          });
          return res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
        });
        
        if (b64) {
          partBuffers[i] = await decodeAudioData(decode(b64), ctx, 24000, 1);
        }
        
        await delay(800); 
        setProgress(Math.round(((i + 1) / scriptData.segments.length) * 100));
      }

      const newPart: StoryPart = {
        id: partNum,
        title: scriptData.title,
        script: scriptData,
        buffers: partBuffers
      };

      setParts(prev => [...prev, newPart]);
      setIsGenerating(false);
      setStatus('Part Ready.');
    } catch (err: any) {
      console.error(err);
      setStatus(`System Halted: ${err.message || 'Unknown error'}`);
      setIsGenerating(false);
    }
  }

  function stopPlayback() {
    setIsPlaying(false);
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch(e) {}
    }
    currentSourceRef.current = null;
  }

  function playSegment(partIdx: number, segIdx: number) {
    if (!isPlaying) return;
    const ctx = ensureAudioContext();
    const part = parts[partIdx];
    if (!part) return;
    
    if (segIdx >= part.script.segments.length) {
      if (partIdx + 1 < parts.length) {
        setActivePartIndex(partIdx + 1);
        setActiveSegmentIndex(0);
        playSegment(partIdx + 1, 0);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    if (part.buffers[segIdx]) {
      const source = ctx.createBufferSource();
      source.buffer = part.buffers[segIdx];
      source.connect(ctx.destination);
      source.onended = () => {
        if (!isPlaying) return;
        setActiveSegmentIndex(segIdx + 1);
        setTimeout(() => playSegment(partIdx, segIdx + 1), 600);
      };
      source.start();
      currentSourceRef.current = source;
    } else {
        setActiveSegmentIndex(segIdx + 1);
        playSegment(partIdx, segIdx + 1);
    }
  }

  async function startPlayback(partIdx: number) {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    setActivePartIndex(partIdx);
    setActiveSegmentIndex(0);
    setIsPlaying(true);
    playSegment(partIdx, 0);
  }

  async function handleExportFullSaga() {
    if (parts.length === 0) return;
    setIsDownloading(true);
    try {
      const ctx = ensureAudioContext();
      let totalSamples = 0;
      parts.forEach(part => {
        Object.values(part.buffers).forEach((buf) => {
          totalSamples += (buf as AudioBuffer).length + (0.5 * ctx.sampleRate);
        });
      });

      const offlineCtx = new OfflineAudioContext(1, totalSamples, ctx.sampleRate);
      let offset = 0;
      for (const part of parts) {
        for (let i = 0; i < part.script.segments.length; i++) {
          const buf = part.buffers[i];
          if (buf) {
            const source = offlineCtx.createBufferSource();
            source.buffer = buf;
            source.connect(offlineCtx.destination);
            source.start(offset);
            offset += buf.duration + 0.5;
          }
        }
      }
      const finalBuffer = await offlineCtx.startRendering();
      const wav = audioBufferToWav(finalBuffer);
      const url = URL.createObjectURL(wav);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${storyTitle.replace(/\s+/g, '_')}_Saga.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Export failed.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 flex flex-col items-center justify-center relative overflow-hidden" onClick={() => ensureAudioContext().resume()}>
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(79,70,229,0.1),transparent_70%)] pointer-events-none"></div>

      <div className="max-w-6xl w-full z-10 flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            STORYGURU
          </h2>
          <p className="text-white/40 uppercase tracking-[0.4em] text-[10px] font-bold">Infinite Quota-Resilient Cinema</p>
        </div>

        {parts.length === 0 && !isGenerating && (
          <div className="max-w-4xl mx-auto w-full glass p-8 md:p-12 rounded-[3.5rem] border-white/10 flex flex-col gap-10 bg-black/40">
            <div className="space-y-4">
              <label className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-2">Saga Seed</label>
              <textarea 
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                placeholder="A legendary explorer finds a city of glass..."
                className="w-full bg-white/5 border border-white/10 rounded-[2rem] p-8 min-h-[160px] outline-none focus:border-indigo-500/50 transition-all text-xl font-light"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                 <label className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-2">Settings</label>
                 <div className="flex gap-3">
                   <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none">
                     {LANGUAGES.map(l => <option key={l.id} value={l.id} className="bg-black">{l.icon} {l.id}</option>)}
                   </select>
                   <select value={selectedGenre} onChange={e => setSelectedGenre(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none">
                     {GENRES.map(g => <option key={g} value={g} className="bg-black">{g}</option>)}
                   </select>
                 </div>
              </div>
              <div className="flex flex-col justify-end">
                <button onClick={handleForgePart} disabled={!initialPrompt.trim()} className="w-full py-8 rounded-[2.5rem] bg-gradient-to-br from-indigo-600 to-purple-700 text-white font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-[1.02] transition-all disabled:opacity-20 active:scale-95">
                  Begin Production
                </button>
              </div>
            </div>
          </div>
        )}

        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-24 gap-12 animate-in fade-in duration-1000">
            <div className="relative">
              <div className="w-48 h-48 border-2 border-white/10 border-t-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                 <i className="fas fa-brain text-4xl text-indigo-500 animate-pulse"></i>
                 <span className="text-[14px] font-black text-white/90">{progress}%</span>
              </div>
            </div>
            <div className="text-center space-y-6">
              <h3 className="text-2xl font-black tracking-widest text-white/90 uppercase">{status}</h3>
              {quotaWait > 0 && (
                 <div className="flex items-center justify-center gap-3 text-red-400 bg-red-400/10 px-6 py-3 rounded-full border border-red-400/20 animate-pulse">
                    <i className="fas fa-clock text-xs"></i>
                    <span className="text-[10px] font-black uppercase tracking-widest">Quota Cooling Down: Resuming in {quotaWait}s</span>
                 </div>
              )}
            </div>
          </div>
        )}

        {parts.length > 0 && !isGenerating && (
          <div className="flex flex-col lg:grid lg:grid-cols-12 gap-8 animate-in fade-in zoom-in-95 duration-700">
            <div className="lg:col-span-4 flex flex-col gap-4">
               <div className="glass p-8 rounded-[3rem] border-white/10 flex flex-col gap-6 bg-black/40">
                  <h3 className="text-xl font-black uppercase tracking-tighter text-indigo-400">Chronology</h3>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                     {parts.map((part, i) => (
                       <button key={part.id} onClick={() => { stopPlayback(); startPlayback(i); }} className={`w-full p-5 rounded-2xl border text-left transition-all flex items-center justify-between group ${activePartIndex === i ? 'bg-indigo-600 border-indigo-600 shadow-lg scale-[1.02]' : 'bg-white/5 border-white/10 hover:border-white/30'}`}>
                          <div>
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-60 block mb-1">Chapter {part.id}</span>
                            <span className="text-sm font-bold truncate block max-w-[150px]">{part.script.title}</span>
                          </div>
                          <i className={`fas ${isPlaying && activePartIndex === i ? 'fa-volume-up' : 'fa-play opacity-20'}`}></i>
                       </button>
                     ))}
                  </div>
                  <button onClick={handleForgePart} className="w-full py-5 rounded-2xl bg-white text-black font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl">
                    Forge Next Part
                  </button>
               </div>

               <div className="glass p-8 rounded-[3rem] border-white/10 bg-indigo-900/10">
                  <button onClick={handleExportFullSaga} disabled={isDownloading} className="w-full py-4 rounded-xl border border-indigo-500/30 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500/20 transition-all flex items-center justify-center gap-3">
                    <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-file-audio'}`}></i>
                    Export Full Saga
                  </button>
               </div>
            </div>

            <div className="lg:col-span-8 glass p-10 rounded-[4rem] border-white/10 bg-black/60 flex flex-col gap-8 relative overflow-hidden shadow-2xl">
               <div className="flex justify-between items-start border-b border-white/5 pb-6">
                  <div>
                    <h3 className="text-3xl font-black uppercase text-white/90">{storyTitle}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mt-2">Active Node: {activeSegmentIndex + 1}/{parts[activePartIndex]?.script.segments.length}</p>
                  </div>
                  <button onClick={isPlaying ? stopPlayback : () => startPlayback(activePartIndex)} className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-red-500' : 'bg-white text-black'}`}>
                    <i className={`fas ${isPlaying ? 'fa-stop' : 'fa-play ml-1'}`}></i>
                  </button>
               </div>

               <div className="max-h-[500px] overflow-y-auto custom-scrollbar pr-6 space-y-12 py-4">
                  {parts[activePartIndex]?.script.segments.map((seg, i) => (
                    <div key={i} className={`transition-all duration-700 ${isPlaying && i === activeSegmentIndex ? 'opacity-100' : 'opacity-20'}`}>
                      <span className="px-3 py-1 rounded-full text-[7px] font-black uppercase tracking-widest bg-white/10 text-indigo-400 mb-4 inline-block">{seg.speaker}</span>
                      <p className="text-2xl font-light italic leading-relaxed text-white/80">"{seg.text}"</p>
                    </div>
                  ))}
               </div>

               <div className="pt-8 border-t border-white/5 flex gap-4">
                  <button onClick={() => { setParts([]); stopPlayback(); }} className="flex-1 py-5 rounded-2xl bg-white/5 border border-white/10 font-black uppercase tracking-widest hover:bg-white/10 transition-all text-xs">Reset Saga</button>
                  <button onClick={onExit} className="px-10 py-5 rounded-2xl bg-white/5 border border-white/10 font-black uppercase tracking-widest hover:text-red-400 transition-all text-xs">Exit</button>
               </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar { width: 3px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(79, 70, 229, 0.2); border-radius: 10px; }` }} />
    </div>
  );
}