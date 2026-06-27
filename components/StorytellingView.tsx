
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
import { GeminiVoice } from '../types';
import { decode, decodeAudioData } from '../utils/audioUtils';

interface StorytellingViewProps {
  onExit: () => void;
}
// ... rest of the file ...
