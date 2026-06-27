import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
import { OrchestratorScript, GeminiVoice } from '../types';
import { decode, decodeAudioData, audioBufferToWav } from '../utils/audioUtils';

interface StoryOrchestratorViewProps {
  onExit: () => void;
}

const AMBIENT_LIBRARY: Record<string, string> = {
  'Horror_Ambience': 'https://assets.mixkit.co/sfx/preview/mixkit-horror-atmosphere-drone-953.mp3',
  'Romantic': 'https://assets.mixkit.co/sfx/preview/mixkit-mysterious-pensive-ambient-2538.mp3',
  'Action': 'https://assets.mixkit.co/sfx/preview/mixkit-battle-ambient-with-explosions-2780.mp3',
  'Adventure': 'https://assets.mixkit.co/sfx/preview/mixkit-forest-at-night-with-crickets-1224.mp3',
  'Mystery': 'https://assets.mixkit.co/sfx/preview/mixkit-light-rain-loop-2393.mp3'
};

const LANGUAGES = [
  { id: 'English', label: 'English', icon: '🇺🇸' },
  { id: 'Hindi', label: 'Hindi', icon: '🇮🇳' },
  { id: 'Arabic', label: 'Arabic', icon: '🇦🇪' },
  { id: 'Spanish', label: 'Spanish', icon: '🇪🇸' },
  { id: 'French', label: 'French', icon: '🇫🇷' },
  { id: 'Japanese', label: 'Japanese', icon: '🇯🇵' },
];

export default function StoryOrchestratorView({ onExit }: StoryOrchestratorViewProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [isProducing, setIsProducing] = useState(false);
  const [status, setStatus] = useState('');
  const [script, setScript] = useState<OrchestratorScript | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [quotaWait, setQuotaWait] = useState(0);
  
  const [isOutputActive, setIsOutputActive] = useState(false);
  const [audioContextState, setAudioContextState] = useState<string>('suspended');

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const voiceBuffersRef = useRef<Record<number, AudioBuffer>>({});
  const ambientBuffersRef = useRef<Record<string, AudioBuffer>>({});
  
  const currentVoiceSource = useRef<AudioBufferSourceNode | null>(null);
  const currentBgmSource = useRef<AudioBufferSourceNode | null>(null);
  const bgmGainNode = useRef<GainNode | null>(null);
  const playbackIndexRef = useRef(0);

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

  function ensureAudioContext(): AudioContext {
    if (!audioContextRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 44100 });
      analyserRef.current = audioContextRef.current!.createAnalyser();
      analyserRef.current!.fftSize = 256;
      analyserRef.current!.connect(audioContextRef.current!.destination);
    }
    return audioContextRef.current!;
  }

  useEffect(() => {
    let anim: number;
    const checkSignal = () => {
      if (audioContextRef.current) {
        setAudioContextState(audioContextRef.current.state);
        if (analyserRef.current && isPlaying) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const avgVol = data.reduce((a, b) => a + b, 0) / data.length;
          setIsOutputActive(avgVol > 3);
        } else {
          setIsOutputActive(false);
        }
      }
      anim = requestAnimationFrame(checkSignal);
    };
    checkSignal();
    return () => cancelAnimationFrame(anim);
  }, [isPlaying]);

  async function loadAudio(url: string, ctx: AudioContext): Promise<AudioBuffer> {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  async function handleProduce() {
    if (!prompt.trim()) return;
    setIsProducing(true);
    setScript(null);
    setProgress(0);
    voiceBuffersRef.current = {};
    
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
      setStatus('Director: Sculpting narrative structure...');
      const scriptRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Act as a Cinematic Sound Director. Expand this prompt into a production script in ${selectedLanguage}: "${prompt}". Break it into 6 sequential scenes. Choose a speaker, emotion, and background mood.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    speaker_type: { type: Type.STRING, enum: ['Narrator', 'Male_Character', 'Female_Character'] },
                    emotion: { type: Type.STRING },
                    bgm_mood: { type: Type.STRING }
                  },
                  required: ['text', 'speaker_type', 'emotion', 'bgm_mood']
                }
              }
            },
            required: ['title', 'scenes']
          }
        }
      }));

      if (!scriptRes.text) throw new Error("No script text generated.");
      const scriptData: OrchestratorScript = JSON.parse(scriptRes.text);
      setScript(scriptData);

      setStatus('Studio: Loading atmospheres...');
      // Fix: Explicitly type uniqueMoods as string[] to avoid 'unknown' index type issues in TS.
      const uniqueMoods: string[] = Array.from(new Set(scriptData.scenes.map(s => s.bgm_mood)));
      await Promise.all(uniqueMoods.map((m: string) => AMBIENT_LIBRARY[m] ? loadAudio(AMBIENT_LIBRARY[m], ctx).then(b => {
        if (ambientBuffersRef.current) ambientBuffersRef.current[m] = b;
      }) : Promise.resolve()));

      for (let i = 0; i < scriptData.scenes.length; i++) {
        const scene = scriptData.scenes[i];
        setStatus(`Synthesis: Rendering Segment ${i + 1}/${scriptData.scenes.length}...`);
        
        const voiceMap: Record<string, GeminiVoice> = {
          'Narrator': 'Zephyr',
          'Male_Character': 'Fenrir',
          'Female_Character': 'Kore'
        };

        const b64 = await callWithRetry<string | null>(async () => {
          const ttsRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: `Style: ${scene.emotion}. ${scene.text}` }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceMap[scene.speaker_type] } } }
            }
          });
          return ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
        });

        if (b64) {
          voiceBuffersRef.current[i] = await decodeAudioData(decode(b64), ctx, 24000, 1);
        }
        await delay(800); 
        setProgress(Math.round(((i + 1) / scriptData.scenes.length) * 100));
      }

      setIsProducing(false);
      setStatus('Production Complete.');
    } catch (err: any) {
      console.error(err);
      setStatus(`Production Failure: ${err.message}`);
      setIsProducing(false);
    }
  }

  function stopPlayback() {
    setIsPlaying(false);
    if (currentVoiceSource.current) try { currentVoiceSource.current.stop(); } catch(e) {}
    if (currentBgmSource.current) try { currentBgmSource.current.stop(); } catch(e) {}
    currentVoiceSource.current = null;
    currentBgmSource.current = null;
  }

  function playNextScene() {
    if (!isPlaying || !script) return;
    const ctx = ensureAudioContext();
    const idx = playbackIndexRef.current;
    if (idx >= script.scenes.length) {
      stopPlayback();
      return;
    }

    const scene = script.scenes[idx];
    if (!currentBgmSource.current || currentBgmSource.current.buffer !== ambientBuffersRef.current[scene.bgm_mood]) {
      if (currentBgmSource.current) try { currentBgmSource.current.stop(); } catch(e) {}
      if (ambientBuffersRef.current[scene.bgm_mood]) {
        const bgm = ctx.createBufferSource();
        bgm.buffer = ambientBuffersRef.current[scene.bgm_mood];
        bgm.loop = true;
        if (bgmGainNode.current) {
          bgm.connect(bgmGainNode.current);
          bgm.start();
          currentBgmSource.current = bgm;
        }
      }
    }

    if (voiceBuffersRef.current[idx]) {
      const voice = ctx.createBufferSource();
      voice.buffer = voiceBuffersRef.current[idx];
      if (analyserRef.current && bgmGainNode.current) {
        voice.connect(analyserRef.current);
        bgmGainNode.current.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.4);
        voice.onended = () => {
          if (!isPlaying) return;
          if (bgmGainNode.current) {
            bgmGainNode.current.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 1.2);
          }
          playbackIndexRef.current++;
          setTimeout(playNextScene, 800);
        };
        voice.start();
        currentVoiceSource.current = voice;
      }
    } else {
        playbackIndexRef.current++;
        setTimeout(playNextScene, 100);
    }
  }

  async function startPlayback() {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    playbackIndexRef.current = 0;
    setIsPlaying(true);
    if (!bgmGainNode.current) {
      bgmGainNode.current = ctx.createGain();
      if (analyserRef.current) {
        bgmGainNode.current.connect(analyserRef.current);
      }
    }
    bgmGainNode.current.gain.setValueAtTime(0.25, ctx.currentTime);
    playNextScene();
  }

  async function handleDownload() {
    if (!script) return;
    setIsDownloading(true);
    try {
      const ctx = ensureAudioContext();
      let totalLength = 0;
      for (let i = 0; i < script.scenes.length; i++) {
        if (voiceBuffersRef.current[i]) totalLength += voiceBuffersRef.current[i].length + (0.5 * ctx.sampleRate);
      }
      const offlineCtx = new OfflineAudioContext(1, totalLength, ctx.sampleRate);
      let offset = 0;
      for (let i = 0; i < script.scenes.length; i++) {
        const vBuf = voiceBuffersRef.current[i];
        if (vBuf) {
          const source = offlineCtx.createBufferSource();
          source.buffer = vBuf;
          source.connect(offlineCtx.destination);
          source.start(offset);
          offset += vBuf.duration + 0.5;
        }
      }
      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Studio_Output.wav`;
      link.click();
    } catch (err) {
      alert("Export failed.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 flex flex-col items-center justify-center relative overflow-hidden" onClick={() => { ensureAudioContext(); audioContextRef.current?.resume(); }}>
      <div className="max-w-4xl w-full z-10 flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-indigo-400">STUDIO ORCHESTRATOR</h2>
          <p className="text-white/40 uppercase tracking-widest text-[10px] font-bold">Smart Quota Management Active</p>
        </div>

        {!script && !isProducing && (
          <div className="glass p-8 md:p-12 rounded-[3.5rem] border-white/10 flex flex-col gap-10 bg-black/40">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A gothic horror story set in a library..." className="w-full bg-white/5 border border-white/10 rounded-[2rem] p-8 min-h-[160px] outline-none text-xl font-light" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                 <label className="text-[10px] uppercase font-black opacity-40">Language</label>
                 <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none">
                   {LANGUAGES.map(l => <option key={l.id} value={l.id} className="bg-black">{l.label}</option>)}
                 </select>
              </div>
              <button onClick={handleProduce} disabled={!prompt.trim()} className="w-full py-8 rounded-[2.5rem] bg-gradient-to-br from-red-600 to-indigo-700 font-black uppercase tracking-widest active:scale-95 disabled:opacity-20 transition-all">Start Production</button>
            </div>
          </div>
        )}

        {isProducing && (
          <div className="flex flex-col items-center justify-center py-24 gap-12">
            <div className="w-48 h-48 border-2 border-white/10 border-t-red-500 rounded-full animate-spin flex items-center justify-center">
              <span className="text-[14px] font-black">{progress}%</span>
            </div>
            <div className="text-center space-y-4">
              <h3 className="text-2xl font-black uppercase text-white/90">{status}</h3>
              {quotaWait > 0 && (
                 <div className="flex items-center justify-center gap-3 text-red-400 bg-red-400/10 px-6 py-3 rounded-full border border-red-400/20 animate-pulse">
                    <span className="text-[10px] font-black uppercase">Quota cooling down... {quotaWait}s remaining</span>
                 </div>
              )}
            </div>
          </div>
        )}

        {script && !isProducing && (
          <div className="glass p-12 rounded-[4.5rem] bg-black/40 border-white/10 flex flex-col gap-10 animate-in fade-in zoom-in-95 duration-700">
             <div className="flex justify-between items-center border-b border-white/5 pb-8">
                <h3 className="text-3xl font-black uppercase">{script.title}</h3>
                <div className="flex gap-4">
                   <button onClick={handleDownload} disabled={isDownloading} className="w-16 h-16 rounded-full glass border border-white/10 flex items-center justify-center"><i className="fas fa-download"></i></button>
                   <button onClick={isPlaying ? stopPlayback : startPlayback} className={`w-16 h-16 rounded-full flex items-center justify-center ${isPlaying ? 'bg-red-500' : 'bg-white text-black'}`}><i className={`fas ${isPlaying ? 'fa-stop' : 'fa-play ml-1'}`}></i></button>
                </div>
             </div>
             <div className="max-h-[400px] overflow-y-auto space-y-12">
                {script.scenes.map((scene, i) => (
                  <div key={i} className={`transition-all duration-700 ${isPlaying && i === playbackIndexRef.current ? 'opacity-100' : 'opacity-20'}`}>
                    <span className="text-[8px] font-black uppercase text-red-400 mb-2 block">{scene.speaker_type}</span>
                    <p className="text-2xl font-light italic leading-relaxed text-white/80">"{scene.text}"</p>
                  </div>
                ))}
             </div>
             <div className="flex gap-4 pt-8 border-t border-white/5">
                <button onClick={() => setScript(null)} className="flex-1 py-5 rounded-2xl bg-white/5 border border-white/10 text-xs font-black uppercase">New Studio Project</button>
                <button onClick={onExit} className="px-10 py-5 rounded-2xl bg-white/5 border border-white/10 text-xs font-black uppercase">Exit</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
