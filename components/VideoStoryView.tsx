
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';

interface VideoStoryViewProps {
  onExit: () => void;
}

const MESSAGES = [
  "Painting the frames of your imagination...",
  "Rendering cinematic sequences...",
  "Synthesizing light and motion...",
  "Finalizing the directorial vision...",
  "Brewing visual magic...",
  "Weaving temporal continuity...",
  "Deep-layer texture mapping..."
];

interface VideoError {
  message: string;
  suggestion: string;
  type: 'quota' | 'safety' | 'complexity' | 'general';
}

const VideoStoryView: React.FC<VideoStoryViewProps> = ({ onExit }) => {
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<VideoError | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      const selected = await (window as any).aistudio.hasSelectedApiKey();
      setHasKey(selected);
    };
    checkKey();
  }, []);

  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
      }, 6000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleSelectKey = async () => {
    await (window as any).aistudio.openSelectKey();
    setHasKey(true);
  };

  const generateVideo = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    setVideoUrl(null);

    try {
      // Correct initialization right before making API call
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      setStatus("Directing Scene...");
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: resolution,
          aspectRatio: aspectRatio
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        // Appending API key for fetch as required
        const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        const blob = await response.blob();
        setVideoUrl(URL.createObjectURL(blob));
      } else {
        throw new Error("Manifestation failed.");
      }

    } catch (err: any) {
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      } else {
        setError({
          type: 'general',
          message: 'The Canvas Tore',
          suggestion: 'A temporal anomaly occurred. Please try again with a different script.'
        });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-8 glass p-12 rounded-[3rem] border-white/10 shadow-2xl">
          <i className="fas fa-film text-5xl text-blue-400 opacity-20 mb-4 block"></i>
          <h2 className="text-3xl font-black tracking-tighter uppercase">Director's Pass Required</h2>
          <p className="text-white/40 text-sm leading-relaxed">
            Video generation requires a paid API key from a Google Cloud Project with billing enabled.
          </p>
          <button onClick={handleSelectKey} className="w-full py-5 rounded-2xl bg-white text-black font-black uppercase tracking-[0.2em] hover:scale-105 transition-transform">Select Access Key</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex gap-2 glass p-1.5 rounded-full">
        <button onClick={onExit} className="px-6 py-2 rounded-full text-sm font-bold text-white/40 hover:text-white transition-all">Explore</button>
        <button className="px-6 py-2 rounded-full text-sm font-bold bg-white text-black">Video Studio</button>
      </div>

      <div className="max-w-4xl w-full z-10 flex flex-col gap-8">
        <div className="text-center">
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
            CINEMATIC MANIFEST
          </h2>
          <p className="text-white/40 uppercase tracking-[0.4em] text-[10px] font-bold">Dream-to-Video Engine</p>
        </div>

        {error && (
          <div className="glass p-8 md:p-12 rounded-[3.5rem] border-red-500/20 bg-red-500/5 text-center flex flex-col items-center gap-6">
            <h3 className="text-2xl font-black uppercase tracking-tight text-red-400">{error.message}</h3>
            <p className="text-white/60">{error.suggestion}</p>
            <button onClick={() => { setError(null); setPrompt(''); }} className="px-10 py-4 rounded-full bg-white text-black font-black uppercase tracking-widest">Retry Vision</button>
          </div>
        )}

        {!videoUrl && !isGenerating && !error && (
          <div className="glass p-8 md:p-10 rounded-[3.5rem] border-white/10 flex flex-col gap-10 animate-in fade-in duration-1000">
            <div className="space-y-4">
              <label className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-2">Visual Script</label>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A cosmic whale swimming through a nebula of liquid gold..."
                className="w-full bg-white/5 border border-white/10 rounded-[2rem] p-8 min-h-[140px] outline-none focus:border-cyan-500/50 transition-all text-xl placeholder:opacity-20 leading-relaxed font-light"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-2">Aspect</label>
                  <div className="flex flex-col gap-2">
                    {['16:9', '9:16'].map(a => (
                      <button key={a} onClick={() => setAspectRatio(a as any)} className={`py-4 rounded-2xl text-[10px] font-black uppercase border transition-all ${aspectRatio === a ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'}`}>
                        {a === '16:9' ? 'Landscape' : 'Portrait'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-2">Quality</label>
                  <div className="flex flex-col gap-2">
                    {['720p', '1080p'].map(r => (
                      <button key={r} onClick={() => setResolution(r as any)} className={`py-4 rounded-2xl text-[10px] font-black uppercase border transition-all ${resolution === r ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-end">
                <button 
                  onClick={generateVideo}
                  disabled={!prompt.trim()}
                  className="w-full py-8 rounded-[2.5rem] bg-white text-black font-black uppercase tracking-[0.3em] transition-all shadow-2xl active:scale-95 disabled:opacity-20"
                >
                  Manifest Vision
                </button>
              </div>
            </div>
          </div>
        )}

        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-24 gap-12 animate-in fade-in duration-1000">
            <div className="relative">
              <div className="w-48 h-48 border-2 border-white/10 border-t-cyan-400 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <i className="fas fa-clapperboard text-4xl text-cyan-400 animate-pulse"></i>
              </div>
            </div>
            <div className="text-center space-y-4">
              <h3 className="text-3xl font-black tracking-tighter text-white/90">{MESSAGES[messageIndex]}</h3>
              <p className="text-cyan-400 text-[10px] uppercase tracking-[0.5em] font-black">{status}</p>
            </div>
          </div>
        )}

        {videoUrl && (
          <div className="flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-1000">
            <div className="glass rounded-[4.5rem] p-4 border-white/10 shadow-2xl relative overflow-hidden group bg-black/40">
               <video 
                 src={videoUrl} 
                 controls 
                 autoPlay 
                 loop 
                 className={`w-full rounded-[3.5rem] ${aspectRatio === '9:16' ? 'max-h-[70vh] object-contain' : 'aspect-video object-cover'}`}
               />
               <div className="absolute top-10 right-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={videoUrl} download="storyscape_vision.mp4" className="w-14 h-14 glass rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
                    <i className="fas fa-download text-xl"></i>
                  </a>
               </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-5">
               <button onClick={() => { setVideoUrl(null); setPrompt(''); }} className="flex-1 py-7 rounded-[2.5rem] bg-white text-black font-black uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-xl">New Manifestation</button>
               <button onClick={onExit} className="px-12 py-7 rounded-[2.5rem] bg-white/5 border border-white/10 font-black uppercase tracking-widest hover:text-red-400 transition-colors">Exit Studio</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoStoryView;
