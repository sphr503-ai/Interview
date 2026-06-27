
import { GoogleGenAI, LiveServerMessage, Modality, GenerateContentResponse } from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { Genre, GeminiVoice, AdventureConfig, NarratorMode } from '../types';

export class StoryScapeService {
  private ai: GoogleGenAI;
  private session: any;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isPaused: boolean = false;
  private isMicActive: boolean = false;
  
  public recordedBuffers: AudioBuffer[] = [];
  public inputAnalyser: AnalyserNode | null = null;
  public outputAnalyser: AnalyserNode | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async startAdventure(
    config: AdventureConfig,
    callbacks: {
      onTranscriptionUpdate: (role: 'user' | 'model', text: string, isFinal: boolean) => void;
      onError: (err: any) => void;
      onClose: () => void;
      onTurnComplete?: () => void;
    },
    history?: Array<{role: 'user' | 'model', text: string}>,
    customSystemInstruction?: string
  ) {
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    this.inputAnalyser = this.inputAudioContext.createAnalyser();
    this.outputAnalyser = this.outputAudioContext.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.outputAnalyser.fftSize = 256;

    const { genre, topic, language, voice, mode } = config;

    const contextSummary = history && history.length > 0 
      ? `Resuming adventure. Previous events: ${history.map(h => `${h.role}: ${h.text}`).join(' | ')}. Continue the saga.`
      : `Begin a new ${genre} adventure about: ${topic}.`;

    const defaultInstruction = `You are a legendary, cinematic narrator for a ${genre} adventure. 
    Language: You must speak and respond exclusively in ${language}.
    Performance Mode: ${mode === NarratorMode.MULTI 
      ? "ACTING MODE: Use distinct voices, accents, and tones for every different character encountered. Act out dialogue with high emotion. Transition between being the narrator and being specific characters seamlessly." 
      : "SINGLE NARRATOR: Speak as a classic, high-quality audiobook narrator. Describe the action and characters with your primary voice texture."}
    
    Topic: The adventure starts with: "${topic}".
    Goal: Lead the user through an immersive story. Describe the environment vividly. 
    Interaction: The user can either type their choices or speak them. Respond to them immediately with rich narration.
    Keep responses medium-length and very descriptive.`;

    const systemInstruction = customSystemInstruction || defaultInstruction;

    const sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          sessionPromise.then(s => s.sendRealtimeInput({ text: contextSummary }));
        },
        onmessage: async (message: LiveServerMessage) => {
          if (this.isPaused) return;
          const b64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (b64) this.handleAudioOutput(b64);

          if (message.serverContent?.inputTranscription) {
            callbacks.onTranscriptionUpdate('user', message.serverContent.inputTranscription.text || '', !!message.serverContent.turnComplete);
          }
          if (message.serverContent?.outputTranscription) {
            callbacks.onTranscriptionUpdate('model', message.serverContent.outputTranscription.text || '', !!message.serverContent.turnComplete);
          }
          if (message.serverContent?.turnComplete) {
            callbacks.onTurnComplete?.();
          }
          if (message.serverContent?.interrupted) this.stopAllAudio();
        },
        onerror: (e: any) => callbacks.onError(e),
        onclose: () => callbacks.onClose(),
      },
    });

    this.session = await sessionPromise;
  }

  public async setMicActive(active: boolean) {
    this.isMicActive = active;
    if (active) {
      if (!this.stream) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const source = this.inputAudioContext!.createMediaStreamSource(this.stream);
          this.scriptProcessor = this.inputAudioContext!.createScriptProcessor(4096, 1, 1);
          this.scriptProcessor.onaudioprocess = (e) => {
            if (this.isPaused || !this.isMicActive) return;
            if (this.session) {
              this.session.sendRealtimeInput({ media: this.createBlob(e.inputBuffer.getChannelData(0)) });
            }
          };
          source.connect(this.inputAnalyser!);
          this.inputAnalyser!.connect(this.scriptProcessor);
          this.scriptProcessor.connect(this.inputAudioContext!.destination);
        } catch (err) {
          console.error("Mic access error:", err);
          this.isMicActive = false;
          throw err;
        }
      }
    }
  }

  private createBlob(data: Float32Array): any {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
    return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
  }

  public static async generateSummary(genre: Genre, history: Array<{role: 'user' | 'model', text: string}>, retryCount = 0): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const transcript = history.map(h => `${h.role}: ${h.text}`).join('\n');
    const prompt = `Summarize this ${genre} adventure concisely into a legendary chronicle excerpt: \n${transcript}`;

    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      return response.text || "...";
    } catch (err: any) {
      if ((err.message?.includes('429') || err.message?.toLowerCase().includes('quota')) && retryCount < 3) {
        await new Promise(r => setTimeout(r, 10000));
        return this.generateSummary(genre, history, retryCount + 1);
      }
      return "The chronicle was lost to time.";
    }
  }

  private async handleAudioOutput(base64: string) {
    if (!this.outputAudioContext || this.isPaused) return;
    this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
    const buf = await decodeAudioData(decode(base64), this.outputAudioContext, 24000, 1);
    this.recordedBuffers.push(buf);
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = buf;
    if (this.outputAnalyser) {
      source.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputAudioContext.destination);
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buf.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  private stopAllAudio() {
    this.sources.forEach(s => { try { s.stop(); } catch(e) {} });
    this.sources.clear();
    this.nextStartTime = 0;
  }

  async stopAdventure() {
    if (this.session) {
      try {
        await this.session.close();
      } catch (e) {
        console.error("Error closing session:", e);
      }
    }
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.error("Error stopping stream tracks:", e);
      }
    }
    this.stopAllAudio();
    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      try {
        await this.inputAudioContext.close();
      } catch (e) {
        console.error("Error closing inputAudioContext:", e);
      }
    }
    if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
      try {
        await this.outputAudioContext.close();
      } catch (e) {
        console.error("Error closing outputAudioContext:", e);
      }
    }
  }

  public sendTextChoice(text: string) { 
    if (this.session) {
      this.session.sendRealtimeInput({ text }); 
    }
  }
  
  public setPaused(paused: boolean) { 
    this.isPaused = paused; 
    if (paused) this.stopAllAudio(); 
  }
}
