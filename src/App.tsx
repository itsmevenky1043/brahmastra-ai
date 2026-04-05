import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ChevronRight, 
  Target, 
  Zap, 
  BarChart3,
  RefreshCw,
  Search,
  BrainCircuit,
  Download,
  Sparkles,
  ArrowRight,
  History,
  LogOut,
  User as UserIcon,
  Calendar,
  Layers,
  Cpu,
  Database as DatabaseIcon,
  Workflow
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import Markdown from 'react-markdown';
import { cn, parsePdf, parseDocx } from './lib/utils';
import { analyzeResume, optimizeResume, type AnalysisResult, type UserPreferences } from './lib/gemini';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  handleFirestoreError,
  OperationType,
  type User 
} from './firebase';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showArchitecture, setShowArchitecture] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>({
    preferredTone: 'Professional',
    preferredTemplate: 'Standard'
  });
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [jd, setJd] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [optimizedResume, setOptimizedResume] = useState<any>(null);
  const [newResult, setNewResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    // Fetch preferences
    const fetchPrefs = async () => {
      try {
        const prefDoc = await getDoc(doc(db, 'profiles', user.uid));
        if (prefDoc.exists()) {
          setPreferences(prefDoc.data() as UserPreferences);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `profiles/${user.uid}`);
      }
    };
    fetchPrefs();

    const q = query(
      collection(db, 'analyses'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );
    
    const unsubHistory = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistory(historyData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'analyses');
    });

    return () => unsubHistory();
  }, [user]);

  const handleSavePreferences = async () => {
    if (!user) return;
    setIsSavingPrefs(true);
    try {
      await setDoc(doc(db, 'profiles', user.uid), {
        ...preferences,
        userId: user.uid,
        updatedAt: serverTimestamp()
      });
      setShowProfile(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `profiles/${user.uid}`);
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
      setError('Failed to sign in with Google.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      reset();
    } catch (err) {
      console.error(err);
    }
  };

  const saveAnalysis = async (analysis: AnalysisResult, optimized: any = null) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'analyses'), {
        userId: user.uid,
        resumeName: file?.name || 'Unknown',
        jdText: jd,
        atsScore: analysis.atsScore,
        matchPercentage: analysis.matchPercentage,
        skillMatch: analysis.skillMatch,
        keywordMatch: analysis.keywordMatch,
        resumeQuality: analysis.resumeQuality,
        missingSkills: analysis.missingSkills,
        extractedSkills: analysis.extractedSkills,
        jdSkills: analysis.jdSkills,
        suggestions: analysis.suggestions,
        summary: analysis.summary,
        timestamp: serverTimestamp(),
        optimizedResume: optimized
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'analyses');
    }
  };

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const isCorrectType = selectedFile.type === 'application/pdf' || 
                           selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const isCorrectSize = selectedFile.size <= MAX_FILE_SIZE;

      if (!isCorrectType) {
        setError('Invalid file type. Please upload a PDF or DOCX file.');
        setFile(null);
        return;
      }

      if (!isCorrectSize) {
        setError('File is too large. Maximum size allowed is 5MB.');
        setFile(null);
        return;
      }

      setFile(selectedFile);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file || !jd.trim()) {
      setError('Please provide both a resume and a job description.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      let text = '';
      if (file.type === 'application/pdf') {
        text = await parsePdf(file);
      } else {
        text = await parseDocx(file);
      }
      setResumeText(text);

      const analysis = await analyzeResume(text, jd);
      setResult(analysis);
      if (user) {
        await saveAnalysis(analysis);
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to analyze resume: ${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleOptimize = async () => {
    if (!result) return;
    setIsOptimizing(true);
    setError(null);

    try {
      const optimized = await optimizeResume(resumeText, jd, result, preferences);
      setOptimizedResume(optimized);

      // Re-score the optimized resume
      const newText = `
        ${optimized.name}
        ${optimized.contact}
        ${optimized.summary}
        
        EXPERIENCE
        ${optimized.experience.map((e: any) => `${e.title} at ${e.company} (${e.duration})\n${e.bullets.join('\n')}`).join('\n\n')}
        
        EDUCATION
        ${optimized.education.map((e: any) => `${e.degree} from ${e.school} (${e.year})`).join('\n\n')}
        
        SKILLS
        ${optimized.skills.join(', ')}
        
        PROJECTS
        ${optimized.projects.map((p: any) => `${p.name}\n${p.description}\n${p.bullets.join('\n')}`).join('\n\n')}
      `;

      const analysis = await analyzeResume(newText, jd);
      setNewResult(analysis);
      if (user) {
        await saveAnalysis(analysis, optimized);
      }
    } catch (err: any) {
      console.error(err);
      setError('Failed to optimize resume. Please try again.');
    } finally {
      setIsOptimizing(false);
    }
  };

  const downloadOptimizedResume = () => {
    if (!optimizedResume) return;

    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(optimizedResume.name, margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(optimizedResume.contact, margin, y);
    y += 15;

    // Summary
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PROFESSIONAL SUMMARY', margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const summaryLines = doc.splitTextToSize(optimizedResume.summary, 170);
    doc.text(summaryLines, margin, y);
    y += (summaryLines.length * 5) + 10;

    // Experience
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('EXPERIENCE', margin, y);
    y += 7;

    optimizedResume.experience.forEach((exp: any) => {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`${exp.title} | ${exp.company}`, margin, y);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text(exp.duration, 190, y, { align: 'right' });
      y += 6;

      doc.setFont('helvetica', 'normal');
      exp.bullets.forEach((bullet: string) => {
        const bulletLines = doc.splitTextToSize(`• ${bullet}`, 160);
        doc.text(bulletLines, margin + 5, y);
        y += (bulletLines.length * 5);
      });
      y += 5;
    });

    // Skills
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('SKILLS', margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const skillsText = optimizedResume.skills.join(', ');
    const skillsLines = doc.splitTextToSize(skillsText, 170);
    doc.text(skillsLines, margin, y);
    y += (skillsLines.length * 5) + 10;

    // Education
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('EDUCATION', margin, y);
    y += 7;
    optimizedResume.education.forEach((edu: any) => {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(edu.degree, margin, y);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`${edu.school} (${edu.year})`, 190, y, { align: 'right' });
      y += 7;
    });

    doc.save('optimized-resume.pdf');
  };

  const downloadOriginalResume = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setResumeText('');
    setResult(null);
    setOptimizedResume(null);
    setNewResult(null);
    setJd('');
    setError(null);
  };

  const scoreData = result ? [
    { name: 'Score', value: result.atsScore },
    { name: 'Remaining', value: 100 - result.atsScore }
  ] : [];

  const radarData = result ? [
    { subject: 'Skill Match', A: result.skillMatch, fullMark: 100 },
    { subject: 'Keywords', A: result.keywordMatch, fullMark: 100 },
    { subject: 'Structure', A: result.resumeQuality, fullMark: 100 },
    { subject: 'Overall', A: result.matchPercentage, fullMark: 100 },
  ] : [];

  const COLORS = ['#3b82f6', '#e2e8f0'];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">
              Brahmastra <span className="text-blue-600">AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500 font-medium hidden sm:inline">Recruiter-Grade AI Analysis</span>
            {user ? (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    setShowArchitecture(!showArchitecture);
                    setShowHistory(false);
                    setShowProfile(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold transition-colors",
                    showArchitecture ? "text-blue-600" : "text-slate-600 hover:text-blue-600"
                  )}
                >
                  <Workflow className="w-4 h-4" />
                  Architecture
                </button>
                <button 
                  onClick={() => {
                    setShowHistory(!showHistory);
                    setShowProfile(false);
                    setShowArchitecture(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold transition-colors",
                    showHistory ? "text-blue-600" : "text-slate-600 hover:text-blue-600"
                  )}
                >
                  <History className="w-4 h-4" />
                  History
                </button>
                <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
                  <button 
                    onClick={() => {
                      setShowProfile(!showProfile);
                      setShowHistory(false);
                      setShowArchitecture(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-slate-200 hover:border-blue-400 transition-all" />
                  </button>
                  <button 
                    onClick={handleLogout}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-all shadow-md shadow-blue-200"
              >
                <UserIcon className="w-4 h-4" />
                Sign In
              </button>
            )}
            {result && (
              <button 
                onClick={reset}
                className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                New Analysis
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {showArchitecture ? (
            <motion.div
              key="architecture"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <Layers className="w-8 h-8 text-blue-600" />
                  System Architecture
                </h2>
                <button 
                  onClick={() => setShowArchitecture(false)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  Back to Analyzer
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-blue-600" />
                    Processing Pipeline
                  </h3>
                  <div className="space-y-4">
                    {[
                      { step: "1. Frontend Layer", desc: "React-based UI for file uploads and real-time analysis visualization." },
                      { step: "2. Parsing Layer", desc: "Extracts raw text from PDF and DOCX using specialized parsers." },
                      { step: "3. NLP Engine", desc: "Lemmatization, tokenization, and feature extraction via Gemini AI." },
                      { step: "4. Matching Engine", desc: "Computes cosine similarity and skill overlap between Resume and JD." },
                      { step: "5. ATS Scoring", desc: "Weighted formula: 50% Skills + 30% Keywords + 20% Quality." },
                      { step: "6. Decision Engine", desc: "Triggers Optimization Engine if ATS score is below 85%." },
                    ].map((item, i) => (
                      <div key={i} className="flex gap-4">
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                          {i + 1}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm">{item.step}</h4>
                          <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="bg-blue-600 p-8 rounded-3xl text-white shadow-xl shadow-blue-200 space-y-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-200" />
                      Optimization Engine
                    </h3>
                    <p className="text-blue-100 text-sm leading-relaxed">
                      When the Decision Engine identifies a low score, it triggers the Optimization Engine to:
                    </p>
                    <ul className="space-y-3">
                      {[
                        "Rewrite bullet points with strong action verbs",
                        "Align skills with Job Description requirements",
                        "Improve professional summary and keyword density",
                        "Generate a new optimized resume structure",
                        "Re-score the result to verify improvement"
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm font-medium">
                          <CheckCircle2 className="w-4 h-4 text-blue-300" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <DatabaseIcon className="w-5 h-5 text-blue-600" />
                      Persistence Layer
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      All analyses and user preferences are stored in a secure NoSQL database (Firestore), 
                      enabling history tracking and personalized optimization.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Database</span>
                        <span className="text-sm font-bold text-slate-800">Firestore</span>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Auth</span>
                        <span className="text-sm font-bold text-slate-800">Firebase Auth</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : showProfile ? (
            <motion.div
              key="profile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <UserIcon className="w-8 h-8 text-blue-600" />
                  User Profile
                </h2>
                <button 
                  onClick={() => setShowProfile(false)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  Back to Analyzer
                </button>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                {/* Account Details */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  <div className="text-center">
                    <img src={user?.photoURL || ''} alt={user?.displayName || ''} className="w-24 h-24 rounded-full border-4 border-blue-50 mx-auto mb-4" />
                    <h3 className="font-bold text-slate-800 text-lg">{user?.displayName}</h3>
                    <p className="text-sm text-slate-500">{user?.email}</p>
                  </div>
                  <div className="pt-6 border-t border-slate-100">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-slate-500 font-medium">Total Analyses</span>
                      <span className="font-bold text-slate-800">{history.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 font-medium">Account Type</span>
                      <span className="font-bold text-blue-600">Free Tier</span>
                    </div>
                  </div>
                </div>

                {/* Preferences */}
                <div className="md:col-span-2 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                      Optimization Preferences
                    </h3>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Preferred Tone</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {['Professional', 'Creative', 'Academic', 'Modern'].map((tone) => (
                            <button
                              key={tone}
                              onClick={() => setPreferences({ ...preferences, preferredTone: tone })}
                              className={cn(
                                "py-3 px-4 rounded-xl text-sm font-bold transition-all border",
                                preferences.preferredTone === tone 
                                  ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" 
                                  : "bg-white border-slate-200 text-slate-600 hover:border-blue-400"
                              )}
                            >
                              {tone}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Preferred Template</label>
                        <div className="grid grid-cols-3 gap-3">
                          {['Standard', 'Minimal', 'Bold'].map((template) => (
                            <button
                              key={template}
                              onClick={() => setPreferences({ ...preferences, preferredTemplate: template })}
                              className={cn(
                                "py-3 px-4 rounded-xl text-sm font-bold transition-all border",
                                preferences.preferredTemplate === template 
                                  ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" 
                                  : "bg-white border-slate-200 text-slate-600 hover:border-blue-400"
                              )}
                            >
                              {template}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={handleSavePreferences}
                      disabled={isSavingPrefs}
                      className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
                    >
                      {isSavingPrefs ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Save Preferences
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : showHistory ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <History className="w-8 h-8 text-blue-600" />
                  Analysis History
                </h2>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  Back to Analyzer
                </button>
              </div>

              <div className="grid gap-4">
                {history.length > 0 ? (
                  history.map((item) => (
                    <div key={item.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-300 transition-all group">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="bg-blue-50 p-3 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <FileText className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-800">{item.resumeName}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {item.timestamp?.toDate().toLocaleDateString()}
                              </span>
                              <span className={cn(
                                "text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider",
                                item.atsScore >= 80 ? "bg-emerald-100 text-emerald-700" : 
                                item.atsScore >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                              )}>
                                Score: {item.atsScore}%
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => {
                              setResult(item);
                              setShowHistory(false);
                            }}
                            className="px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            View Result
                          </button>
                          {item.optimizedResume && (
                            <button 
                              onClick={() => {
                                setOptimizedResume(item.optimizedResume);
                                setResult(item);
                                setShowHistory(false);
                              }}
                              className="px-4 py-2 text-sm font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            >
                              View Optimization
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
                    <History className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400 font-medium">No analysis history found.</p>
                  </div>
                )}
              </div>
            </motion.div>
          ) : !result ? (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Welcome Hero */}
              <div className="text-center max-w-3xl mx-auto mb-12">
                <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4 tracking-tight">
                  Welcome to <span className="text-blue-600">Brahmastra AI</span>
                </h2>
                <p className="text-lg text-slate-600 font-medium leading-relaxed">
                  <span className="text-blue-600 font-bold">Resume Analyzer & ATS Optimizer</span>. 
                  Developed by <span className="text-blue-600 font-bold">Bijjam Venkateswara Reddy</span>. 
                  Upload your resume and job description to receive an intelligent match score, 
                  identify missing skills, and get actionable insights to improve your chances 
                  of landing your dream job.
                </p>
              </div>

              <div className="grid lg:grid-cols-2 gap-8">
              {/* Left Column: File Upload */}
              <div className="space-y-6">
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Upload className="w-5 h-5 text-blue-600" />
                    Upload Resume
                  </h2>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all",
                      file ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                    )}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".pdf,.docx"
                      className="hidden"
                    />
                    {file ? (
                      <div className="text-center">
                        <FileText className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                        <p className="font-semibold text-slate-800">{file.name}</p>
                        <p className="text-sm text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                        <button className="mt-4 text-sm font-bold text-blue-600 hover:underline">Change File</button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <div className="bg-slate-100 p-4 rounded-full inline-block mb-4">
                          <Upload className="w-8 h-8 text-slate-400" />
                        </div>
                        <p className="font-semibold text-slate-800">Click to upload or drag and drop</p>
                        <p className="text-sm text-slate-500 mt-1">PDF or DOCX (Max 5MB)</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-blue-600 p-8 rounded-2xl text-white shadow-lg shadow-blue-200">
                  <h3 className="text-xl font-bold mb-2">How it works</h3>
                  <p className="text-blue-100 text-sm leading-relaxed mb-6">
                    Our AI simulates a modern Applicant Tracking System to score your resume against specific job requirements.
                  </p>
                  <ul className="space-y-4">
                    {[
                      "Keyword matching & density analysis",
                      "Skill gap identification",
                      "Formatting & structural feedback",
                      "Actionable optimization tips"
                    ].map((item, i) => (
                      <li key={i} className="flex items-center gap-3 text-sm font-medium">
                        <CheckCircle2 className="w-5 h-5 text-blue-300 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Right Column: JD Input */}
              <div className="space-y-6">
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Job Description
                  </h2>
                  <textarea 
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste the job description here to analyze the match..."
                    className="flex-1 w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm leading-relaxed min-h-[300px]"
                  />
                  
                  {error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm font-medium">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || !file || !jd.trim()}
                    className={cn(
                      "mt-6 w-full py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 shadow-lg",
                      isAnalyzing || !file || !jd.trim() 
                        ? "bg-slate-300 cursor-not-allowed" 
                        : "bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-blue-200"
                    )}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing with AI...
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5" />
                        Run ATS Analysis
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
            <motion.div 
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              {/* Decision Engine Banner */}
              {result.atsScore < 85 && !optimizedResume && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-blue-600 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl shadow-blue-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-white/20 p-3 rounded-2xl">
                      <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-lg">Improve Your Resume</h4>
                      <p className="text-blue-100 font-medium">Get a stronger, job-matched version instantly</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleOptimize}
                    disabled={isOptimizing}
                    className="whitespace-nowrap px-8 py-4 bg-white text-blue-600 hover:bg-blue-50 font-black rounded-xl transition-all flex items-center gap-2 shadow-lg"
                  >
                    {isOptimizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                    Improve My Resume
                  </button>
                </motion.div>
              )}

              {/* Results Hero */}
              <div className="grid md:grid-cols-3 gap-8">
                {/* Score Gauge */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4">
                    <Target className="w-6 h-6 text-slate-100" />
                  </div>
                  
                  <div className="text-center mb-6">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-1">ATS Score</h3>
                    <div className={cn(
                      "text-xs font-bold px-3 py-1 rounded-full inline-block",
                      result.atsScore >= 85 ? "bg-emerald-100 text-emerald-700" :
                      result.atsScore >= 70 ? "bg-blue-100 text-blue-700" :
                      "bg-amber-100 text-amber-700"
                    )}>
                      {result.atsScore >= 85 ? "Excellent Match" :
                       result.atsScore >= 70 ? "Good Match" :
                       "Needs Improvement"}
                    </div>
                  </div>

                  <div className="relative w-48 h-48 mb-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={scoreData}
                          cx="50%"
                          cy="50%"
                          innerRadius={65}
                          outerRadius={85}
                          paddingAngle={0}
                          dataKey="value"
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                        >
                          {scoreData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={index === 0 ? (
                                result.atsScore >= 85 ? '#10b981' : 
                                result.atsScore >= 70 ? '#3b82f6' : '#f59e0b'
                              ) : '#f1f5f9'} 
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-6xl font-black text-slate-800 tracking-tighter">{result.atsScore}</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Score</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 w-full">
                    <ul className="space-y-2">
                      {Array.isArray(result.summary) ? (
                        result.summary.map((point, i) => (
                          <li key={i} className="flex gap-2 text-xs font-medium text-slate-600 leading-relaxed">
                            <span className="text-blue-500 mt-1">•</span>
                            <span>{point}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-xs font-medium text-slate-600 leading-relaxed text-center">
                          {result.summary}
                        </li>
                      )}
                    </ul>
                  </div>
                  
                  {file && (
                    <button 
                      onClick={downloadOriginalResume}
                      className="mt-6 flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest"
                    >
                      <Download className="w-3 h-3" />
                      Original File
                    </button>
                  )}
                </div>

                {/* Quick Stats */}
                <div className="md:col-span-2 space-y-4">
                  {[
                    { label: 'Skill Match', value: result.skillMatch, color: 'bg-emerald-500' },
                    { label: 'Keyword Match', value: result.keywordMatch, color: 'bg-blue-500' },
                    { label: 'Resume Quality', value: result.resumeQuality, color: 'bg-indigo-500' },
                    { label: 'Overall Match', value: result.matchPercentage, color: 'bg-violet-500' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-bold text-slate-500">{stat.label}</span>
                        <span className="text-lg font-black text-slate-800">{stat.value}%</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${stat.value}%` }}
                          transition={{ duration: 1, delay: i * 0.1 }}
                          className={cn("h-full rounded-full", stat.color)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resume Structure Breakdown */}
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Resume Structure Breakdown</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase">Quality Score:</span>
                    <span className="text-sm font-black text-blue-600">{result.resumeQuality}%</span>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={result.sectionBreakdown}
                      margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis 
                        dataKey="section" 
                        type="category" 
                        width={100} 
                        tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [`${value}%`, 'Weight']}
                      />
                      <Bar 
                        dataKey="percentage" 
                        fill="#3b82f6" 
                        radius={[0, 4, 4, 0]} 
                        barSize={20}
                      >
                        {result.sectionBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3b82f6' : '#60a5fa'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-4 text-xs text-slate-400 font-medium text-center italic">
                  This chart represents the relative length and impact of each section. A well-structured resume typically prioritizes Experience and Skills.
                </p>
              </div>

              {/* Detailed Breakdown */}
              <div className="grid lg:grid-cols-3 gap-8">
                {/* Suggestions */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                      <Target className="w-6 h-6 text-blue-600" />
                      Optimization Suggestions
                    </h3>
                    <div className="prose prose-slate max-w-none prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600">
                      <Markdown>{result.suggestions}</Markdown>
                    </div>
                  </div>
                </div>

                {/* Skills Sidebar */}
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-red-500">
                      <AlertCircle className="w-5 h-5" />
                      Missing Skills
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {result.missingSkills.length > 0 ? (
                        result.missingSkills.map((skill, i) => (
                          <span key={i} className="px-3 py-1 bg-red-50 text-red-600 text-xs font-bold rounded-full border border-red-100">
                            {skill}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400 italic">No major skills missing!</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-600">
                      <Search className="w-5 h-5" />
                      JD Key Skills
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {result.jdSkills.map((skill, i) => (
                        <span key={i} className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-bold rounded-full border border-blue-100">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="w-5 h-5" />
                      Your Skills
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {result.extractedSkills.map((skill, i) => (
                        <span key={i} className="px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-full border border-emerald-100">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resume Optimization Engine Results */}
              {optimizedResume && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  {/* Re-Scoring Engine */}
                  <div className="bg-blue-900 text-white p-8 rounded-3xl shadow-2xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                      <Sparkles className="w-32 h-32" />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-2xl font-black mb-8 flex items-center gap-3">
                        <History className="w-8 h-8 text-blue-400" />
                        Re-Scoring Engine Results
                      </h3>
                      <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <span className="block text-sm font-bold text-blue-300 uppercase tracking-widest mb-2">Old Score</span>
                            <span className="text-6xl font-black text-blue-100 opacity-50">{result.atsScore}%</span>
                          </div>
                          <ArrowRight className="w-8 h-8 text-blue-400" />
                          <div className="text-center">
                            <span className="block text-sm font-bold text-emerald-400 uppercase tracking-widest mb-2">New Score</span>
                            <span className="text-7xl font-black text-white drop-shadow-lg">{newResult?.atsScore}%</span>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="bg-blue-800/50 p-4 rounded-2xl border border-blue-700">
                            <p className="text-sm font-medium text-blue-100">
                              🚀 <span className="font-bold text-white">Optimization Success!</span> Your resume has been enhanced with missing skills and ATS-friendly action verbs.
                            </p>
                          </div>
                          <button 
                            onClick={downloadOptimizedResume}
                            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-emerald-900/20"
                          >
                            <Download className="w-6 h-6" />
                            Download Optimized Resume (PDF)
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Optimized Preview */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-xl font-bold mb-8 flex items-center gap-2">
                      <Sparkles className="w-6 h-6 text-blue-600" />
                      Optimized Resume Preview
                    </h3>
                    <div className="max-w-4xl mx-auto p-12 border border-slate-100 rounded-xl shadow-inner bg-slate-50/50">
                      <div className="text-center mb-8">
                        <h1 className="text-3xl font-black text-slate-800">{optimizedResume.name}</h1>
                        <p className="text-slate-500 font-medium mt-2">{optimizedResume.contact}</p>
                      </div>
                      
                      <div className="space-y-8">
                        <section>
                          <h4 className="text-sm font-black text-blue-600 uppercase tracking-widest mb-3 border-b border-blue-100 pb-2">Professional Summary</h4>
                          <p className="text-slate-700 leading-relaxed">{optimizedResume.summary}</p>
                        </section>

                        <section>
                          <h4 className="text-sm font-black text-blue-600 uppercase tracking-widest mb-3 border-b border-blue-100 pb-2">Experience</h4>
                          <div className="space-y-6">
                            {optimizedResume.experience.map((exp: any, i: number) => (
                              <div key={i}>
                                <div className="flex justify-between items-start mb-2">
                                  <div>
                                    <h5 className="font-bold text-slate-800">{exp.title}</h5>
                                    <p className="text-sm text-slate-500 font-medium">{exp.company}</p>
                                  </div>
                                  <span className="text-xs font-bold text-slate-400">{exp.duration}</span>
                                </div>
                                <ul className="list-disc list-inside space-y-1">
                                  {exp.bullets.map((bullet: string, j: number) => (
                                    <li key={j} className="text-sm text-slate-600 leading-relaxed">{bullet}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section>
                          <h4 className="text-sm font-black text-blue-600 uppercase tracking-widest mb-3 border-b border-blue-100 pb-2">Skills</h4>
                          <div className="flex flex-wrap gap-2">
                            {optimizedResume.skills.map((skill: string, i: number) => (
                              <span key={i} className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-md">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </section>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-slate-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <BrainCircuit className="w-5 h-5" />
            <span className="text-sm font-bold">Brahmastra AI</span>
          </div>
          <p className="text-sm text-slate-400 font-medium">
            Designed and Developed by Bijjam Venkateswara Reddy • Privacy-First Analysis
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest">Privacy</a>
            <a href="#" className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest">Terms</a>
            <a href="#" className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
