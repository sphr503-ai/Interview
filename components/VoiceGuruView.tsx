import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
import { VoiceGuruManifest, CastMember, GeminiVoice } from '../types';
import { decode, decodeAudioData, audioBufferToWav } from '../utils/audioUtils';

interface VoiceGuruViewProps {
  onExit: () => void;
}

const LANGUAGES = [
  { id: 'English', icon: '🇺🇸' },
  { id: 'Hindi', icon: '🇮🇳' },
  { id: 'Japanese', icon: '🇯🇵' },
  { id: 'Arabic', icon: '🇦🇪' },
  { id: 'Spanish', icon: '🇪🇸' },
];

const PRESETS = [
  { id: 'Cinema', label: 'Grand Cinema', icon: 'fa-film' },
  { id: 'Eldritch', label: 'Eldritch Horror', icon: 'fa-ghost' },
  { id: 'Fable', label: 'Magic Fable', icon: 'fa-wand-magic-sparkles' },
  { id: 'NeoNoir', label: 'Neo-Noir', icon: 'fa-umbrella' },
];

export default function VoiceGuruView({ onExit }: VoiceGuruViewProps) {
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('English');
  const [preset, setPreset] = useState('Cinema');
  const [targetMinutes, setTargetMinutes] = useState(2);
  
  const [isProducing, setIsProducing] = useState(false);
  const [manifest, setManifest] = useState<VoiceGuruManifest | null>(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [quotaWait, setQuotaWait] = useState(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const voiceBuffersRef = useRef<Record<number, AudioBuffer>>({});
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  async function callWithRetry<T>(apiCall: () => Promise<T>, retryCount = 0): Promise<T> {
    try {
      return await apiCall();
    } catch (err: any) {
      if ((err.message?.includes('429') || err.message?.toLowerCase().includes('quota')) && retryCount < 5) {
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

  function ensureAudioCtx(): AudioContext {
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx({ sampleRate: 44100 });
    }
    return audioContextRef.current!;
  }

  async function handleProduce() {
    if (!prompt.trim()) return;
    setIsProducing(true);
    setManifest(null);
    setProgress(0);
    voiceBuffersRef.current = {};
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
      setStatus('Casting: Analyzing roles & ages...');
      const castingRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Act as a Casting Director. Analyze this prompt for characters: "${prompt}". 
        Create a Cast List. For each character, assign: 
        - id: unique string
        - name: character name
        - role: description
        - age_group: Child, Teen, Adult, or Senior.
        - is_supernatural: true for ghosts/spirits/monsters.
        - assigned_voice: Choose from [Puck (Child/Teen), Kore (Female Adult), Zephyr (Narrator/Male Adult), Charon (Senior/Stoic), Fenrir (Villain/Deep Senior)].`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                age_group: { type: Type.STRING, enum: ['Child', 'Teen', 'Adult', 'Senior'] },
                is_supernatural: { type: Type.BOOLEAN },
                assigned_voice: { type: Type.STRING, enum: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] }
              },
              required: ['id', 'name', 'role', 'age_group', 'is_supernatural', 'assigned_voice']
            }
          }
        }
      }));

      const cast: CastMember[] = JSON.parse(castingRes.text || '[]');
      
      setStatus('Studio: Weaving production script...');
      const scriptRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Act as a Cinema Producer. Using this cast: ${JSON.stringify(cast)}, write a ${targetMinutes} minute audio story in ${language}. Prompt: "${prompt}". Style: ${preset}.
        Format as a sequential list of segments. Each segment must refer to a cast_id.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              directors_notes: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    cast_id: { type: Type.STRING },
                    text: { type: Type.STRING },
                    emotion: { type: Type.STRING },
                    pacing: { type: Type.STRING, enum: ['slow', 'normal', 'fast'] }
                  },
                  required: ['cast_id', 'text', 'emotion', 'pacing']
                }
              }
            },
            required: ['title', 'scenes', 'directors_notes']
          }
        }
      }));

      const manifestData: VoiceGuruManifest = { ...JSON.parse(scriptRes.text || '{}'), cast };
      setManifest(manifestData);

      for (let i = 0; i < manifestData.scenes.length; i++) {
        const seg = manifestData.scenes[i];
        const member = manifestData.cast.find(c => c.id === seg.cast_id);
        if (!member) continue;

        setStatus(`Production: Rendering ${member.name} (${member.age_group})...`);
        
        let styleMod = `Style: ${seg.emotion}. Pacing: ${seg.pacing}. `;
        if (member.age_group === 'Senior') styleMod += "Speak with a gravelly, seasoned, slow texture. ";
        if (member.age_group === 'Child') styleMod += "Speak with high-pitched, youthful innocence and energy. ";
        if (member.is_supernatural) styleMod += "EFFECT: Deliver in a spectral, hollow, echoing, and terrifying ghostly manner. ";

        const b64 = await callWithRetry<string | null>(async () => {
          const res = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: `${styleMod} Content: ${seg.text}` }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: member.assigned_voice } }
              }
            }
          });
          return res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
        });

        if (b64) {
          voiceBuffersRef.current[i] = await decodeAudioData(decode(b64), ctx, 24000, 1);
        }
        
        await delay(1200); 
        setProgress(Math.round(((i + 1) / manifestData.scenes.length) * 100));
      }

      setIsProducing(false);
      setStatus('Saga Manifested.');
    } catch (err: any) {
      console.error(err);
      setStatus(`System Error: ${err.message}`);
      setIsProducing(false);
    }
  }

  function stopPlayback() {
    setIsPlaying(false);
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch(e) {}
    }
    currentSourceRef.current = null;
  }

  function playSegment(idx: number) {
    if (!isPlaying || !manifest) return;
    const ctx = ensureAudioCtx();
    
    if (idx >= manifest.scenes.length) {
      stopPlayback();
      return;
    }

    if (voiceBuffersRef.current[idx]) {
      const source = ctx.createBufferSource();
      source.buffer = voiceBuffersRef.current[idx];
      source.connect(ctx.destination);
      source.onended = () => {
        if (!isPlaying) return;
        setActiveIdx(idx + 1);
        setTimeout(() => playSegment(idx + 1), 600);
      };
      source.start();
      currentSourceRef.current = source;
    } else {
        setActiveIdx(idx + 1);
        playSegment(idx + 1);
    }
  }

  async function startPlayback() {
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    setActiveIdx(0);
    setIsPlaying(true);
    playSegment(0);
  }

  async function handleExport() {
    if (!manifest) return;
    setIsDownloading(true);
    try {
      const ctx = ensureAudioCtx();
      let totalLength = 0;
      Object.values(voiceBuffersRef.current).forEach(b => totalLength += (b as AudioBuffer).length + (0.4 * ctx.sampleRate));

      const offlineCtx = new OfflineAudioContext(1, totalLength, ctx.sampleRate);
      let offset = 0;
      for (let i = 0; i < manifest.scenes.length; i++) {
        const buf = voiceBuffersRef.current[i];
        if (buf) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buf;
          source.connect(offlineCtx.destination);
          source.start(offset);
          offset += buf.duration + 0.4;
        }
      }
      const rendered = await offlineCtx.startRendering();
      const wav = audioBufferToWav(rendered);
      const url = URL.createObjectURL(wav);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${manifest.title.replace(/\s+/g, '_')}_Master.wav`;
      link.click();
    } catch (e) {
      alert("Mastering Error");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050508] text-white p-6 md:p-12 flex flex-col items-center justify-center relative overflow-hidden" onClick={() => ensureAudioCtx().resume()}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#1e1b4b_0%,transparent_70%)] pointer-events-none opacity-40"></div>
      
      <div className="max-w-6xl w-full z-10 flex flex-col gap-10">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300">VOICEGURU</h2>
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20">Production Engine v2.0 • AI Director Enabled</p>
          </div>
          <button onClick={onExit} className="px-8 py-3 rounded-full glass border-white/5 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all">Exit Studio</button>
        </div>

        {!manifest && !isProducing && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in zoom-in-95 duration-700">
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="glass p-10 rounded-[4rem] border-white/10 bg-black/40 shadow-2xl">
                <label className="text-[10px] uppercase font-black opacity-30 block mb-4 ml-4">Cinema Seed (Script/Prompt)</label>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="The old Dada ji and his grandson enter the haunted temple..."
                  className="w-full bg-white/5 border border-white/10 rounded-[2.5rem] p-10 min-h-[250px] outline-none focus:border-indigo-500/40 transition-all text-2xl font-light leading-relaxed placeholder:opacity-10"
                />
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="glass p-10 rounded-[3.5rem] border-white/10 bg-black/40 space-y-8">
                <div className="space-y-4">
                  <label className="text-[10px] uppercase font-black opacity-30 ml-4">Chronicle Length</label>
                  <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <input type="range" min="1" max="60" value={targetMinutes} onChange={e => setTargetMinutes(parseInt(e.target.value))} className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    <span className="text-sm font-black text-blue-400 w-12 text-center">{targetMinutes}m</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {PRESETS.map(p => (
                    <button key={p.id} onClick={() => setPreset(p.id)} className={`flex flex-col items-center gap-2 p-4 rounded-3xl border transition-all ${preset === p.id ? 'bg-indigo-600 border-indigo-400 shadow-lg' : 'bg-white/5 border-white/10 opacity-30'}`}>
                      <i className={`fas ${p.icon} text-lg`}></i>
                      <span className="text-[8px] font-black uppercase tracking-tighter">{p.label}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] uppercase font-black opacity-30 ml-4">Dialect</label>
                  <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-xs font-black uppercase tracking-widest outline-none">
                    {LANGUAGES.map(l => <option key={l.id} value={l.id} className="bg-black">{l.id}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleProduce} disabled={!prompt.trim()} className="w-full py-10 rounded-[3rem] bg-gradient-to-br from-blue-600 to-indigo-800 font-black uppercase tracking-[0.4em] shadow-2xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-20 text-sm">
                Begin Production
              </button>
            </div>
          </div>
        )}

        {isProducing && (
          <div className="flex flex-col items-center justify-center py-20 gap-12">
            <div className="w-64 h-64 rounded-full border border-white/5 flex items-center justify-center relative shadow-[0_0_120px_rgba(30,58,138,0.2)]">
              <div className="absolute inset-0 border-t-2 border-blue-400 rounded-full animate-spin"></div>
              <div className="absolute inset-4 border border-white/10 rounded-full flex flex-col items-center justify-center bg-black/20">
                <span className="text-5xl font-black">{progress}%</span>
                <p className="text-[8px] font-black uppercase opacity-40 mt-2">Manifesting</p>
              </div>
            </div>
            <div className="text-center space-y-4">
              <h3 className="text-3xl font-black uppercase tracking-tighter text-white/90">{status}</h3>
              {quotaWait > 0 && (
                <div className="flex items-center justify-center gap-3 text-red-400 animate-pulse bg-red-400/5 px-8 py-3 rounded-full border border-red-400/20">
                  <i className="fas fa-hourglass-half text-xs"></i>
                  <span className="text-[10px] font-black uppercase tracking-widest">Quota Cooling Down: {quotaWait}s</span>
                </div>
              )}
            </div>
          </div>
        )}

        {manifest && !isProducing && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 animate-in fade-in zoom-in-95 duration-1000">
            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="glass p-10 rounded-[4rem] border-white/10 bg-black/60 shadow-2xl flex flex-col gap-6">
                 <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center text-xl text-blue-400 border border-blue-500/20">
                       <i className="fas fa-clapperboard"></i>
                    </div>
                    <div>
                       <h3 className="text-xl font-black uppercase tracking-tighter leading-none">Casting List</h3>
                       <p className="text-[8px] font-bold text-white/20 mt-2 uppercase tracking-widest">Character Continuity Engaged</p>
                    </div>
                 </div>
                 <div className="space-y-3">
                    {manifest.cast.map(c => (
                      <div key={c.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                         <div>
                            <span className="text-xs font-black block">{c.name}</span>
                            <span className="text-[8px] uppercase opacity-40 tracking-widest">{c.age_group} • {c.assigned_voice}</span>
                         </div>
                         {c.is_supernatural && <i className="fas fa-ghost text-blue-400 text-xs animate-pulse"></i>}
                      </div>
                    ))}
                 </div>
                 <div className="pt-6 border-t border-white/5 space-y-3">
                    <button onClick={isPlaying ? stopPlayback : startPlayback} className={`w-full py-7 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-4 transition-all ${isPlaying ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.3)]' : 'bg-white text-black hover:scale-105'}`}>
                       <i className={`fas ${isPlaying ? 'fa-stop' : 'fa-play'}`}></i>
                       {isPlaying ? 'Cut' : 'Screening'}
                    </button>
                    <button onClick={handleExport} disabled={isDownloading} className="w-full py-5 rounded-2xl glass border-white/10 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-white/5">
                       <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-download text-blue-400'}`}></i>
                       Master Sountrack (.wav)
                    </button>
                 </div>
              </div>
            </div>

            <div className="lg:col-span-8 glass p-12 rounded-[5rem] border-white/10 bg-black/80 flex flex-col gap-10 min-h-[600px] overflow-hidden shadow-2xl relative">
               <div className="absolute top-0 left-0 w-full h-1 bg-white/5 overflow-hidden">
                  <div className="h-full bg-blue-500 shadow-[0_0_20px_#3b82f6] transition-all duration-1000" style={{ width: `${(activeIdx / manifest.scenes.length) * 100}%` }}></div>
               </div>
               
               <div className="flex-1 overflow-y-auto custom-scrollbar space-y-24 py-10 px-4">
                  {manifest.scenes.map((seg, i) => {
                    const actor = manifest.cast.find(c => c.id === seg.cast_id);
                    return (
                      <div key={i} className={`transition-all duration-1000 ${i === activeIdx && isPlaying ? 'opacity-100 scale-100 translate-x-0' : 'opacity-10 scale-95 -translate-x-4 blur-[1px]'}`}>
                         <div className="flex items-center gap-4 mb-8">
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] px-5 py-1.5 rounded-full bg-white/10 border border-white/5 text-blue-400">
                               {actor?.name || 'Unknown'}
                            </span>
                            <span className="text-[8px] font-bold opacity-30 uppercase tracking-widest">{seg.emotion} • {seg.pacing}</span>
                         </div>
                         <p className="text-5xl font-light leading-snug italic font-serif text-white/90 tracking-tight">"{seg.text}"</p>
                      </div>
                    );
                  })}
               </div>

               <div className="flex gap-4 p-4 glass rounded-[3rem] border-white/5 bg-black/20">
                  <button onClick={() => { setManifest(null); stopPlayback(); }} className="flex-1 py-6 rounded-3xl glass border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all">New Production</button>
                  <button onClick={onExit} className="px-12 py-6 rounded-3xl glass border-white/10 text-[10px] font-black uppercase tracking-widest hover:text-red-400 transition-all">Close</button>
               </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar { width: 5px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(59, 130, 246, 0.2); border-radius: 10px; }` }} />
    </div>
  );
}