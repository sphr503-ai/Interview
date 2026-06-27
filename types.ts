
export enum Genre {
  FANTASY = 'Fantasy',
  SCIFI = 'Sci-Fi',
  MYSTERY = 'Mystery',
  HORROR = 'Horror'
}

export enum ViewMode {
  HOME = 'home',
  ADVENTURE = 'adventure',
  SETUP = 'setup'
}

export type GeminiVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export enum NarratorMode {
  SINGLE = 'Single Narrator',
  MULTI = 'Multiple Characters'
}

export interface AdventureConfig {
  genre: Genre;
  topic: string;
  language: string;
  voice: GeminiVoice;
  mode: NarratorMode;
  durationMinutes?: number; // Added for Story Files deep sleep sessions
}

export interface StoryState {
  genre: Genre | null;
  isActive: boolean;
  voice: GeminiVoice;
  transcriptionHistory: Array<{
    role: 'user' | 'model';
    text: string;
  }>;
}

export interface OrchestratorScript {
  title: string;
  scenes: Array<{
    text: string;
    speaker_type: 'Narrator' | 'Male_Character' | 'Female_Character';
    emotion: string;
    bgm_mood: string;
  }>;
}

export interface GuruScript {
  title: string;
  segments: Array<{
    speaker: string;
    text: string;
    voice_id: GeminiVoice;
    speed: 'slow' | 'normal' | 'fast';
    emotion: string;
  }>;
  summary: string;
}

export interface StoryPart {
  id: number;
  title: string;
  script: GuruScript;
  buffers: Record<number, AudioBuffer>;
}

export interface CastMember {
  id: string;
  name: string;
  role: string;
  age_group: 'Child' | 'Teen' | 'Adult' | 'Senior';
  is_supernatural: boolean;
  assigned_voice: GeminiVoice;
}

export interface VoiceGuruManifest {
  title: string;
  directors_notes: string;
  scenes: Array<{
    cast_id: string;
    text: string;
    emotion: string;
    pacing: 'slow' | 'normal' | 'fast';
  }>;
  cast: CastMember[];
}
