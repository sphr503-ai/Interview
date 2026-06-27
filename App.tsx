
import React, { useState, useEffect } from 'react';
import { Genre, ViewMode, AdventureConfig, NarratorMode, GeminiVoice } from './types';
import AdventureView from './components/AdventureView';
import StoryFilesView from './components/StoryFilesView';
import IntervieweeView from './components/IntervieweeView';

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Hindi", "Japanese", "Chinese", "Arabic"
];

const VOICES: Array<{ id: GeminiVoice; name: string; description: string }> = [
  { id: 'Zephyr', name: 'Zephyr', description: 'Warm & Encouraging' },
  { id: 'Puck', name: 'Puck', description: 'Youthful & Energetic' },
  { id: 'Charon', name: 'Charon', description: 'Stoic & Deep' },
  { id: 'Kore', name: 'Kore', description: 'Calm & Graceful' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Gravelly & Intense' },
];

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.HOME);
  const [activeTab, setActiveTab] = useState<'adventures' | 'files' | 'interviewee'>('interviewee');
  const [sessionOrigin, setSessionOrigin] = useState<'adventures' | 'files' | 'interviewee' | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [setupConfig, setSetupConfig] = useState<AdventureConfig | null>(null);
  const [audioState, setAudioState] = useState<'suspended' | 'running' | 'closed'>('suspended');

  // Interviewee specific state
  const [currentJob, setCurrentJob] = useState(() => {
    const locked = localStorage.getItem('storyscape_current_job_locked') === 'true';
    if (locked) {
      return localStorage.getItem('storyscape_current_job') || 'React developer with 2 years of frontend experience';
    }
    return 'React developer with 2 years of frontend experience';
  });
  const [appliedJob, setAppliedJob] = useState(() => {
    const locked = localStorage.getItem('storyscape_applied_job_locked') === 'true';
    if (locked) {
      return localStorage.getItem('storyscape_applied_job') || 'Senior Frontend Engineer with strong focus on architecture and React 19';
    }
    return 'Senior Frontend Engineer with strong focus on architecture and React 19';
  });
  const [answerLength, setAnswerLength] = useState<'short' | 'detailed'>('detailed');
  const [englishLevel, setEnglishLevel] = useState<'easy' | 'normal' | 'fluent'>('normal');
  const [currentSalary, setCurrentSalary] = useState('$80,000 / year');
  const [expectedSalary, setExpectedSalary] = useState('$110,000 / year');

  useEffect(() => {
    let active = true;
    const checkAudio = () => {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const tempCtx = new AudioCtx();
        setAudioState(tempCtx.state);
        tempCtx.onstatechange = () => {
          if (active) {
            setAudioState(tempCtx.state);
          }
        };
        setTimeout(() => {
          if (active && tempCtx.state !== 'closed') {
            tempCtx.close().catch(() => {});
          }
        }, 1000);
      }
    };
    checkAudio();
    return () => {
      active = false;
    };
  }, []);

  const handleFixAudio = async () => {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const tempCtx = new AudioCtx();
      try {
        await tempCtx.resume();
        setAudioState(tempCtx.state);
      } catch (e) {
        console.error("Failed to resume temporary AudioContext:", e);
      }
      if (tempCtx.state !== 'closed') {
        try {
          await tempCtx.close();
        } catch (e) {
          console.error("Failed to close temporary AudioContext:", e);
        }
      }
      // Log to console instead of a blocking window.alert
      console.log("Audio engine primed.");
    }
  };

  const handleStartSetup = (genre: Genre) => {
    setSelectedGenre(genre);
    setSessionOrigin(activeTab);
    setViewMode(ViewMode.SETUP);
  };

  const handleStartSetupInterview = (category: string) => {
    setSelectedCategory(category);
    setSessionOrigin('interviewee');
    setViewMode(ViewMode.SETUP);
  };

  const finalizeSetup = (config: AdventureConfig) => {
    let finalTopic = config.topic.trim();
    if (!finalTopic) {
      const randomTopics: Record<Genre, string[]> = {
        [Genre.FANTASY]: ["A lost dragon egg", "The whispering woods", "A thief stealing a god's crown"],
        [Genre.SCIFI]: ["First contact on a frozen moon", "A glitch in the simulation", "The last oxygen tank"],
        [Genre.MYSTERY]: ["The empty train car", "The painting that changes at night", "A message from 50 years ago"],
        [Genre.HORROR]: ["The sound behind the walls", "A mirror that reflects a different room", "The never-ending fog"]
      };
      const genreTopics = randomTopics[config.genre];
      finalTopic = genreTopics[Math.floor(Math.random() * genreTopics.length)];
    }
    setSetupConfig({ ...config, topic: finalTopic });
    setViewMode(ViewMode.ADVENTURE);
  };

  const renderHome = () => (
    <div className="min-h-screen flex flex-col items-center p-6 bg-[#0a0a0a] overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full"></div>

      <div className="max-w-6xl w-full text-center z-10 pt-12 md:pt-20">
        <h1 className="text-6xl md:text-8xl font-black mb-4 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/40">
          Growthify
        </h1>
        <p className="text-xl md:text-2xl text-white/50 mb-16 max-w-2xl mx-auto font-light">
          Real-Time Simulated Job Candidate Room.
        </p>

        {/* Dynamic Genre Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CategoryCard 
            category="Technical Prep" 
            icon="fa-laptop-code" 
            desc="Diving deep into code, system design, and algorithms."
            color="hover:border-indigo-500/50"
            onStart={() => handleStartSetupInterview("Technical Prep")}
          />
          <CategoryCard 
            category="Behavioral Prep" 
            icon="fa-comments" 
            desc="Answering soft skills, leadership, and situational questions."
            color="hover:border-emerald-500/50"
            onStart={() => handleStartSetupInterview("Behavioral Prep")}
          />
          <CategoryCard 
            category="Executive Prep" 
            icon="fa-briefcase" 
            desc="For manager, director, and C-suite leadership roles."
            color="hover:border-amber-500/50"
            onStart={() => handleStartSetupInterview("Executive Prep")}
          />
          <CategoryCard 
            category="General Mock" 
            icon="fa-user-tie" 
            desc="Standard mock interviews and resume walkthrough prep."
            color="hover:border-sky-500/50"
            onStart={() => handleStartSetupInterview("General Mock")}
          />
        </div>
      </div>
    </div>
  );

  const renderSetup = () => {
    if (sessionOrigin === 'interviewee') {
      if (!selectedCategory) return null;
      return (
        <SetupView 
          genre={null} 
          category={selectedCategory}
          origin="interviewee" 
          onBack={() => setViewMode(ViewMode.HOME)} 
          onConfirm={(config, extra) => {
            if (extra) {
              setCurrentJob(extra.currentJob);
              setAppliedJob(extra.appliedJob);
              setAnswerLength(extra.answerLength);
              setEnglishLevel(extra.englishLevel);
              setCurrentSalary(extra.currentSalary);
              setExpectedSalary(extra.expectedSalary);
            }
            setSetupConfig(config);
            setViewMode(ViewMode.ADVENTURE);
          }} 
        />
      );
    }
    if (!selectedGenre) return null;
    return <SetupView genre={selectedGenre} origin={sessionOrigin || 'adventures'} onBack={() => setViewMode(ViewMode.HOME)} onConfirm={finalizeSetup} />;
  };

  const renderContent = () => {
    if (viewMode === ViewMode.ADVENTURE) {
      if (sessionOrigin === 'interviewee' && selectedCategory) {
        return (
          <IntervieweeView 
            currentJobDescription={currentJob}
            appliedJobDescription={appliedJob}
            answerLength={answerLength}
            englishLevel={englishLevel}
            currentSalary={currentSalary}
            expectedSalary={expectedSalary}
            language={setupConfig?.language || 'English'}
            voice={setupConfig?.voice || 'Zephyr'}
            category={selectedCategory}
            onExit={() => {
              setViewMode(ViewMode.HOME);
              setSetupConfig(null);
              setSessionOrigin(null);
              setSelectedCategory(null);
            }} 
          />
        );
      }
      if (setupConfig) {
        if (sessionOrigin === 'files') {
          return (
            <StoryFilesView 
              config={setupConfig} 
              onExit={() => {
                setViewMode(ViewMode.HOME);
                setSetupConfig(null);
                setSessionOrigin(null);
              }} 
            />
          );
        }
        return (
          <AdventureView 
            config={setupConfig} 
            onExit={() => {
              setViewMode(ViewMode.HOME);
              setSetupConfig(null);
              setSessionOrigin(null);
            }} 
          />
        );
      }
    }
    if (viewMode === ViewMode.SETUP) return renderSetup();
    return renderHome();
  };

  return <div className="min-h-screen bg-[#0a0a0a]">{renderContent()}</div>;
};

interface SetupViewProps {
  genre: Genre | null;
  category?: string;
  origin: 'adventures' | 'files' | 'interviewee';
  onBack: () => void;
  onConfirm: (
    config: AdventureConfig, 
    extra?: { 
      currentJob: string; 
      appliedJob: string; 
      answerLength: 'short' | 'detailed';
      englishLevel: 'easy' | 'normal' | 'fluent';
      currentSalary: string;
      expectedSalary: string;
    }
  ) => void;
}

const SetupView: React.FC<SetupViewProps> = ({ genre, category, origin, onBack, onConfirm }) => {
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('English');
  const [voice, setVoice] = useState<GeminiVoice>('Zephyr');
  const [mode, setMode] = useState<NarratorMode>(NarratorMode.SINGLE);
  const [duration, setDuration] = useState(15);

  // Local interviewee state fields with lock persistence
  const [currentJobLocked, setCurrentJobLocked] = useState(() => {
    return localStorage.getItem('storyscape_current_job_locked') === 'true';
  });
  const [appliedJobLocked, setAppliedJobLocked] = useState(() => {
    return localStorage.getItem('storyscape_applied_job_locked') === 'true';
  });

  const [localCurrentJob, setLocalCurrentJob] = useState(() => {
    const locked = localStorage.getItem('storyscape_current_job_locked') === 'true';
    if (locked) {
      return localStorage.getItem('storyscape_current_job') || 'React developer with 2 years of frontend experience';
    }
    return 'React developer with 2 years of frontend experience';
  });

  const [localAppliedJob, setLocalAppliedJob] = useState(() => {
    const locked = localStorage.getItem('storyscape_applied_job_locked') === 'true';
    if (locked) {
      return localStorage.getItem('storyscape_applied_job') || 'Senior Frontend Engineer with strong focus on architecture and React 19';
    }
    return 'Senior Frontend Engineer with strong focus on architecture and React 19';
  });

  const [localAnswerLen, setLocalAnswerLen] = useState<'short' | 'detailed'>('detailed');

  const [localEnglishLevel, setLocalEnglishLevel] = useState<'easy' | 'normal' | 'fluent'>(() => {
    return (localStorage.getItem('storyscape_english_level') as any) || 'normal';
  });

  const [localCurrentSalary, setLocalCurrentSalary] = useState(() => {
    return localStorage.getItem('storyscape_current_salary') || '$80,000 / year';
  });

  const [localExpectedSalary, setLocalExpectedSalary] = useState(() => {
    return localStorage.getItem('storyscape_expected_salary') || '$110,000 / year';
  });

  const toggleCurrentJobLock = () => {
    const nextVal = !currentJobLocked;
    setCurrentJobLocked(nextVal);
    localStorage.setItem('storyscape_current_job_locked', String(nextVal));
    if (nextVal) {
      localStorage.setItem('storyscape_current_job', localCurrentJob);
    }
  };

  const toggleAppliedJobLock = () => {
    const nextVal = !appliedJobLocked;
    setAppliedJobLocked(nextVal);
    localStorage.setItem('storyscape_applied_job_locked', String(nextVal));
    if (nextVal) {
      localStorage.setItem('storyscape_applied_job', localAppliedJob);
    }
  };

  const handleCurrentJobChange = (val: string) => {
    setLocalCurrentJob(val);
    if (currentJobLocked) {
      if (val.trim()) {
        localStorage.setItem('storyscape_current_job', val);
      }
    }
  };

  const handleAppliedJobChange = (val: string) => {
    setLocalAppliedJob(val);
    if (appliedJobLocked) {
      if (val.trim()) {
        localStorage.setItem('storyscape_applied_job', val);
      }
    }
  };

  const handleEnglishLevelChange = (val: 'easy' | 'normal' | 'fluent') => {
    setLocalEnglishLevel(val);
    localStorage.setItem('storyscape_english_level', val);
  };

  const handleCurrentSalaryChange = (val: string) => {
    setLocalCurrentSalary(val);
    localStorage.setItem('storyscape_current_salary', val);
  };

  const handleExpectedSalaryChange = (val: string) => {
    setLocalExpectedSalary(val);
    localStorage.setItem('storyscape_expected_salary', val);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0a0a0a] relative">
      <div className="max-w-3xl w-full glass p-8 md:p-12 rounded-[3.5rem] border-white/10 space-y-8 z-10">
        <div className="text-center space-y-2">
          <h2 className="text-4xl font-black uppercase tracking-tighter">
            {origin === 'interviewee' 
              ? `Mock Interview: ${category}` 
              : origin === 'files' 
                ? 'Prepare Archive Log' 
                : 'Forge Your Destiny'}
          </h2>
          <p className="text-white/40 uppercase tracking-widest text-xs">
            {origin === 'interviewee' ? 'Candidate Room Setup' : `${genre} Saga`}
          </p>
        </div>

        <div className="space-y-6">
          {origin === 'interviewee' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between px-2">
                  <label className="text-[10px] uppercase font-black opacity-40 tracking-widest">Current Job / Background Description</label>
                  <button
                    type="button"
                    onClick={toggleCurrentJobLock}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
                      currentJobLocked
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.05)]'
                        : 'bg-white/5 text-white/30 border border-white/5 hover:text-white/60 hover:bg-white/10'
                    }`}
                    title={currentJobLocked ? "Locked to database" : "Lock to database"}
                  >
                    {currentJobLocked ? (
                      <>
                        <i className="fas fa-lock text-[8px]"></i> Locked 🔒
                      </>
                    ) : (
                      <>
                        <i className="fas fa-unlock text-[8px]"></i> Unlocked 🔓
                      </>
                    )}
                  </button>
                </div>
                <textarea 
                  value={localCurrentJob} 
                  onChange={e => handleCurrentJobChange(e.target.value)}
                  placeholder="E.g. Software Engineer with 3 years of React experience..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-white/30 transition-all text-sm resize-none text-white"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between px-2">
                  <label className="text-[10px] uppercase font-black opacity-40 tracking-widest">Target Job / Applied Job Description</label>
                  <button
                    type="button"
                    onClick={toggleAppliedJobLock}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
                      appliedJobLocked
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.05)]'
                        : 'bg-white/5 text-white/30 border border-white/5 hover:text-white/60 hover:bg-white/10'
                    }`}
                    title={appliedJobLocked ? "Locked to database" : "Lock to database"}
                  >
                    {appliedJobLocked ? (
                      <>
                        <i className="fas fa-lock text-[8px]"></i> Locked 🔒
                      </>
                    ) : (
                      <>
                        <i className="fas fa-unlock text-[8px]"></i> Unlocked 🔓
                      </>
                    )}
                  </button>
                </div>
                <textarea 
                  value={localAppliedJob} 
                  onChange={e => handleAppliedJobChange(e.target.value)}
                  placeholder="E.g. Senior Frontend developer role requiring Node.js and cloud systems..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-white/30 transition-all text-sm resize-none text-white"
                />
              </div>

              <div className="space-y-4">
                <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Candidate Answer Depth</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setLocalAnswerLen('short')}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${localAnswerLen === 'short' ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-60 text-white'}`}
                  >
                    <span className="text-xs font-black uppercase">Short Answers</span>
                    <span className="text-[9px] opacity-65">2 - 5 lines of text</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocalAnswerLen('detailed')}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${localAnswerLen === 'detailed' ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-60 text-white'}`}
                  >
                    <span className="text-xs font-black uppercase">Detailed Answers</span>
                    <span className="text-[9px] opacity-65">5 - 10 lines of text</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">AI English Vocabulary Style</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => handleEnglishLevelChange('easy')}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${localEnglishLevel === 'easy' ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-60 text-white'}`}
                  >
                    <span className="text-xs font-black uppercase">Easy 🌱</span>
                    <span className="text-[9px] opacity-65">Simple english words</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnglishLevelChange('normal')}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${localEnglishLevel === 'normal' ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-60 text-white'}`}
                  >
                    <span className="text-xs font-black uppercase">Normal 💬</span>
                    <span className="text-[9px] opacity-65">Standard professional</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnglishLevelChange('fluent')}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-1 ${localEnglishLevel === 'fluent' ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-60 text-white'}`}
                  >
                    <span className="text-xs font-black uppercase">Fluent ⚡</span>
                    <span className="text-[9px] opacity-65">Eloquence & advanced vocabulary</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Compensation details (For Salary negotiation)</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-30 ml-1 tracking-widest">Current Salary</label>
                    <input 
                      type="text"
                      value={localCurrentSalary}
                      onChange={e => handleCurrentSalaryChange(e.target.value)}
                      placeholder="E.g. $80,000 / year"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:border-white/30 transition-all text-xs text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-30 ml-1 tracking-widest">Expected Salary</label>
                    <input 
                      type="text"
                      value={localExpectedSalary}
                      onChange={e => handleExpectedSalaryChange(e.target.value)}
                      placeholder="E.g. $110,000 / year"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:border-white/30 transition-all text-xs text-white"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Adventure Topic (Optional)</label>
                <input 
                  type="text" 
                  value={topic} 
                  onChange={e => setTopic(e.target.value)}
                  placeholder="Leave empty for a surprise..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-white/30 transition-all text-sm"
                />
              </div>

              {origin === 'files' && (
                <div className="space-y-4 glass p-6 rounded-3xl border-white/5">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Story Duration (Minutes)</label>
                    <span className="text-sm font-black text-white">{duration}m</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="60" 
                    value={duration} 
                    onChange={e => setDuration(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                  <p className="text-[9px] opacity-30 uppercase tracking-widest text-center mt-2">Maximum 60 Minutes • Deep Sleep Optimization</p>
                </div>
              )}
            </>
          )}

          <div className={`grid grid-cols-1 ${origin === 'interviewee' ? '' : 'md:grid-cols-2'} gap-6`}>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Language</label>
              <select 
                value={language} 
                onChange={e => setLanguage(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none text-sm appearance-none text-white"
              >
                {LANGUAGES.map(l => <option key={l} value={l} className="bg-black text-white">{l}</option>)}
              </select>
            </div>
            {origin !== 'interviewee' && (
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Narrator Performance</label>
                <select 
                  value={mode} 
                  onChange={e => setMode(e.target.value as NarratorMode)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none text-sm appearance-none text-white"
                >
                  <option value={NarratorMode.SINGLE} className="bg-black text-white">Single Narrator</option>
                  <option value={NarratorMode.MULTI} className="bg-black text-white">Multiple Character Performance</option>
                </select>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <label className="text-[10px] uppercase font-black opacity-40 ml-2 tracking-widest">Candidate Voice Accent / Texture</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {VOICES.map(v => (
                <button
                  key={v.id}
                  onClick={() => setVoice(v.id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-2xl border transition-all ${voice === v.id ? 'bg-white text-black border-white shadow-lg' : 'bg-white/5 border-white/10 opacity-40'}`}
                >
                  <span className="text-[10px] font-bold">{v.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button onClick={onBack} className="flex-1 py-5 rounded-3xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all text-white">Back</button>
          <button 
            onClick={() => onConfirm(
              { genre: genre || Genre.SCIFI, topic, language, voice, mode, durationMinutes: origin === 'files' ? duration : undefined },
              origin === 'interviewee' ? { 
                currentJob: localCurrentJob, 
                appliedJob: localAppliedJob, 
                answerLength: localAnswerLen,
                englishLevel: localEnglishLevel,
                currentSalary: localCurrentSalary,
                expectedSalary: localExpectedSalary
              } : undefined
            )} 
            className="flex-[2] py-5 rounded-3xl bg-white text-black text-xs font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-2xl"
          >
            {origin === 'interviewee' ? 'Start Mock Interview' : origin === 'files' ? 'Seal Archive Log' : `Enter ${genre} Realm`}
          </button>
        </div>
      </div>
    </div>
  );
};

interface GenreCardProps {
  genre: Genre;
  icon: string;
  desc: string;
  color: string;
  onStart: () => void;
}

const GenreCard: React.FC<GenreCardProps> = ({ genre, icon, desc, color, onStart }) => (
  <button onClick={onStart} className={`group p-8 glass rounded-[2.5rem] border border-white/5 transition-all duration-500 flex flex-col items-center text-center relative ${color} hover:scale-105 active:scale-95`}>
    <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
      <i className={`fas ${icon} text-3xl opacity-80 group-hover:opacity-100 transition-opacity text-white`}></i>
    </div>
    <h3 className="text-2xl font-bold mb-3 tracking-tight text-white">{genre}</h3>
    <p className="text-xs opacity-40 leading-relaxed mb-6 text-white">{desc}</p>
    <div className="mt-auto w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest group-hover:bg-white group-hover:text-black transition-all text-white">
      Select Realm
    </div>
  </button>
);

interface CategoryCardProps {
  category: string;
  icon: string;
  desc: string;
  color: string;
  onStart: () => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, icon, desc, color, onStart }) => (
  <button onClick={onStart} className={`group p-8 glass rounded-[2.5rem] border border-white/5 transition-all duration-500 flex flex-col items-center text-center relative ${color} hover:scale-105 active:scale-95`}>
    <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
      <i className={`fas ${icon} text-3xl opacity-80 group-hover:opacity-100 transition-opacity text-white`}></i>
    </div>
    <h3 className="text-2xl font-bold mb-3 tracking-tight text-white">{category}</h3>
    <p className="text-xs opacity-40 leading-relaxed mb-6 text-white">{desc}</p>
    <div className="mt-auto w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest group-hover:bg-white group-hover:text-black transition-all text-white">
      Enter Boardroom
    </div>
  </button>
);

export default App;
