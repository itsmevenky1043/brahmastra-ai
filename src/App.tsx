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
  Edit3,
  X,
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
import { analyzeResume, optimizeResume, type AnalysisResult, type UserPreferences, type OptimizedResume } from './lib/gemini';
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
  const [optimizedResume, setOptimizedResume] = useState<OptimizedResume | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedResume, setEditedResume] = useState<OptimizedResume | null>(null);

  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleSaveEdit = async () => {
    if (editedResume) {
      setIsSavingEdit(true);
      setOptimizedResume(editedResume);
      
      try {
        const resumeString = `
          ${editedResume.name}
          ${editedResume.contact}
          ${editedResume.summary}
          ${editedResume.technicalSkills.map(s => `${s.category}: ${s.skills.join(', ')}`).join('\n')}
          ${editedResume.internships.map(i => `${i.title} at ${i.company}\n${i.bullets.join('\n')}`).join('\n')}
          ${editedResume.projects.map(p => `${p.name}\n${p.bullets.join('\n')}`).join('\n')}
          ${editedResume.education.map(e => `${e.degree} from ${e.school}`).join('\n')}
          ${editedResume.certifications.join('\n')}
          ${editedResume.interests.join(', ')}
        `;
        
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText: resumeString, jdText: jd }),
        });
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        let analysis;
        if (data.result) {
          analysis = data.result;
        } else {
          analysis = await pollJob('analysis', data.jobId);
        }

        setNewResult(analysis);
        setIsEditing(false);
      } catch (err) {
        console.error('Failed to re-score edited resume:', err);
      } finally {
        setIsSavingEdit(false);
      }
    }
  };
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

  const pollJob = async (queue: 'analysis' | 'optimization', jobId: string): Promise<any> => {
    if (jobId === 'cached') return null;

    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          reject(new Error('Job timed out. Please try again.'));
          return;
        }

        try {
          const res = await fetch(`/api/job/${queue}/${jobId}`);
          if (!res.ok) throw new Error(`Server error: ${res.status}`);
          
          const data = await res.json();

          if (data.status === 'completed') {
            clearInterval(interval);
            resolve(data.result);
          } else if (data.status === 'failed') {
            clearInterval(interval);
            reject(new Error(data.error || 'Job failed'));
          }
        } catch (err) {
          console.error('Polling error:', err);
          // Don't reject immediately on network error, try a few more times
          if (attempts > maxAttempts) {
            clearInterval(interval);
            reject(err);
          }
        }
      }, 2000);
    });
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

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: text, jdText: jd }),
      });
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      let analysis;
      if (data.result) {
        analysis = data.result;
      } else {
        analysis = await pollJob('analysis', data.jobId);
      }

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
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jdText: jd, analysis: result }),
      });
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const optimized = await pollJob('optimization', data.jobId);
      setOptimizedResume(optimized);
      setEditedResume(optimized);

      // Re-score the optimized resume using the API
      const resumeString = `
        ${optimized.name}
        ${optimized.contact}
        ${optimized.summary}
        ${optimized.technicalSkills.map((s: any) => `${s.category}: ${s.skills.join(', ')}`).join('\n')}
        ${optimized.internships.map((i: any) => `${i.title} at ${i.company}\n${i.bullets.join('\n')}`).join('\n')}
        ${optimized.projects.map((p: any) => `${p.name}\n${p.bullets.join('\n')}`).join('\n')}
        ${optimized.education.map((e: any) => `${e.degree} from ${e.school}`).join('\n')}
        ${optimized.certifications.join('\n')}
        ${optimized.interests.join(', ')}
      `;
      
      const resScore = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: resumeString, jdText: jd }),
      });
      
      const scoreData = await resScore.json();
      if (scoreData.error) throw new Error(scoreData.error);

      let analysis;
      if (scoreData.result) {
        analysis = scoreData.result;
      } else {
        analysis = await pollJob('analysis', scoreData.jobId);
      }

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
    const data = editedResume || optimizedResume;
    if (!data) return;

    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    const checkPageBreak = (needed: number) => {
      if (y + needed > 275) { // Leave a bit more space at the bottom
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };

    // Header
    doc.setFontSize(14);
    doc.setFont('times', 'bold');
    const nameWidth = doc.getTextWidth(data.name);
    doc.text(data.name, (pageWidth - nameWidth) / 2, y);
    y += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    // Ensure contact is pipe separated for HackerRank style
    const contactText = data.contact.replace(/,/g, ' | ').replace(/\s*\|\s*/g, ' | ');
    const contactWidth = doc.getTextWidth(contactText);
    doc.text(contactText, (pageWidth - contactWidth) / 2, y);
    y += 10;

    const drawSectionHeader = (title: string) => {
      checkPageBreak(15);
      doc.setFontSize(12);
      doc.setFont('times', 'bold');
      doc.text(title.toUpperCase(), margin, y);
      y += 1.5;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    };

    // Summary
    drawSectionHeader('Professional Summary');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const summaryLines = doc.splitTextToSize(data.summary, contentWidth);
    checkPageBreak(summaryLines.length * 5);
    doc.text(summaryLines, margin, y);
    y += (summaryLines.length * 5) + 6;

    // Technical Skills
    drawSectionHeader('Technical Skills');
    data.technicalSkills.forEach(skillGroup => {
      const skillsText = skillGroup.skills.join(', ');
      const categoryLabel = `${skillGroup.category}: `;
      const categoryWidth = doc.getTextWidth(categoryLabel);
      const skillsLines = doc.splitTextToSize(skillsText, contentWidth - categoryWidth);
      
      checkPageBreak((skillsLines.length * 5) + 1);
      
      doc.setFont('times', 'bold');
      doc.text(categoryLabel, margin, y);
      
      doc.setFont('helvetica', 'normal');
      doc.text(skillsLines, margin + categoryWidth, y);
      y += (skillsLines.length * 5) + 1.5;
    });
    y += 4;

    // Internships
    if (data.internships && data.internships.length > 0) {
      drawSectionHeader('Internships');
      data.internships.forEach(intern => {
        checkPageBreak(12);
        doc.setFontSize(10);
        doc.setFont('times', 'bold');
        doc.text(intern.title, margin, y);
        
        doc.setFont('helvetica', 'bold');
        const companyText = ` | ${intern.company}`;
        doc.text(companyText, margin + doc.getTextWidth(intern.title), y);
        
        doc.setFont('helvetica', 'normal');
        const durationWidth = doc.getTextWidth(intern.duration);
        doc.text(intern.duration, pageWidth - margin - durationWidth, y);
        y += 5;
        
        intern.bullets.forEach(bullet => {
          const bulletLines = doc.splitTextToSize(`• ${bullet}`, contentWidth - 5);
          checkPageBreak(bulletLines.length * 5);
          doc.text(bulletLines, margin + 5, y);
          y += (bulletLines.length * 5);
        });
        y += 2;
      });
      y += 2;
    }

    // Projects
    drawSectionHeader('Projects');
    data.projects.forEach(project => {
      checkPageBreak(12);
      doc.setFontSize(10);
      doc.setFont('times', 'bold');
      doc.text(project.name, margin, y);
      
      if (project.techStack) {
        doc.setFont('helvetica', 'italic');
        const tsText = ` (${project.techStack})`;
        doc.text(tsText, margin + doc.getTextWidth(project.name), y);
      }

      if (project.link) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 255);
        const linkText = 'Project Link';
        const linkWidth = doc.getTextWidth(linkText);
        doc.text(linkText, pageWidth - margin - linkWidth, y);
        doc.setTextColor(0, 0, 0);
      }
      y += 5;
      
      project.bullets.forEach(bullet => {
        const bulletLines = doc.splitTextToSize(`• ${bullet}`, contentWidth - 5);
        checkPageBreak(bulletLines.length * 5);
        doc.text(bulletLines, margin + 5, y);
        y += (bulletLines.length * 5);
      });
      y += 2;
    });
    y += 2;

    // Education
    drawSectionHeader('Education');
    data.education.forEach(edu => {
      checkPageBreak(12);
      doc.setFontSize(10);
      doc.setFont('times', 'bold');
      doc.text(edu.school, margin, y);
      
      doc.setFont('helvetica', 'normal');
      const durationWidth = doc.getTextWidth(edu.duration);
      doc.text(edu.duration, pageWidth - margin - durationWidth, y);
      y += 5;
      
      doc.setFont('helvetica', 'italic');
      doc.text(`${edu.degree} | ${edu.gpa}`, margin, y);
      doc.setFont('helvetica', 'normal');
      y += 8;
    });

    // Certifications
    drawSectionHeader('Certifications');
    data.certifications.forEach(cert => {
      checkPageBreak(6);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`• ${cert}`, margin, y);
      y += 6;
    });
    y += 4;

    // Interests
    drawSectionHeader('Interests');
    checkPageBreak(10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`• ${data.interests.join(', ')}`, margin, y);

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
                      { step: "1. Rate Limiting", desc: "Prevents abuse and ensures fair resource distribution for 5000+ concurrent users." },
                      { step: "2. Job Queue (BullMQ)", desc: "Decouples requests from execution, buffering spikes in traffic to prevent 503 errors." },
                      { step: "3. Redis Caching", desc: "Instantly serves results for identical Resume/JD pairs, reducing redundant AI calls." },
                      { step: "4. Background Workers", desc: "Scalable workers process jobs asynchronously with exponential backoff retries." },
                      { step: "5. NLP Engine (Gemini)", desc: "Advanced analysis and optimization with automatic retry on model high demand." },
                      { step: "6. Real-time Polling", desc: "Frontend polls for job completion, providing a seamless 'processing' experience." },
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
                      All analyses and user preferences are stored in Firestore, 
                      while Redis handles real-time job queuing and result caching 
                      for high-performance scaling.
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Database</span>
                        <span className="text-sm font-bold text-slate-800">Firestore</span>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Cache/Queue</span>
                        <span className="text-sm font-bold text-slate-800">Redis</span>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Auth</span>
                        <span className="text-sm font-bold text-slate-800">Firebase</span>
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
                  className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 rounded-[2rem] flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-blue-200 border border-blue-500/20 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
                    <Sparkles className="w-48 h-48 text-white" />
                  </div>
                  <div className="flex items-center gap-6 relative z-10">
                    <div className="bg-white/20 p-4 rounded-3xl backdrop-blur-md border border-white/30">
                      <Target className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h4 className="font-black text-white text-2xl tracking-tight">Score is below 85%</h4>
                      <p className="text-blue-100 font-bold text-lg opacity-90">Our AI can rewrite your resume using expert templates to reach 85+ instantly.</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleOptimize}
                    disabled={isOptimizing}
                    className="whitespace-nowrap px-10 py-5 bg-white text-blue-600 hover:bg-blue-50 font-black rounded-2xl transition-all flex items-center gap-3 shadow-xl hover:scale-[1.05] active:scale-[0.95] relative z-10"
                  >
                    {isOptimizing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
                    Optimize Now (Target 85+)
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
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-blue-600" />
                        Optimized Resume Preview
                      </h3>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => {
                            setEditedResume(optimizedResume);
                            setIsEditing(true);
                          }}
                          className="px-4 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-2"
                        >
                          <Edit3 className="w-4 h-4" />
                          Edit Resume
                        </button>
                        <div className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black rounded-full border border-blue-100 uppercase tracking-widest">
                          ATS Optimized
                        </div>
                      </div>
                    </div>
                    
                    <div className="max-w-4xl mx-auto p-12 border border-slate-100 rounded-xl shadow-inner bg-white">
                      {/* Visual Preview of the JSON */}
                      <div className="space-y-6 text-slate-800">
                        <div className="text-center space-y-2">
                          <h2 className="text-3xl font-bold text-slate-900">{optimizedResume.name}</h2>
                          <p className="text-sm text-slate-500">{optimizedResume.contact}</p>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Professional Summary</h4>
                          <p className="text-sm leading-relaxed">{optimizedResume.summary}</p>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Technical Skills</h4>
                          <div className="space-y-1">
                            {optimizedResume.technicalSkills.map((group, i) => (
                              <p key={i} className="text-sm">
                                <span className="font-bold">• {group.category}:</span> {group.skills.join(', ')}
                              </p>
                            ))}
                          </div>
                        </div>

                        {optimizedResume.internships.length > 0 && (
                          <div className="space-y-4">
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Internships</h4>
                            {optimizedResume.internships.map((intern, i) => (
                              <div key={i} className="space-y-1">
                                <div className="flex justify-between font-bold text-sm">
                                  <span>{intern.title}</span>
                                  <span>{intern.duration}</span>
                                </div>
                                <p className="text-sm italic text-slate-600">{intern.company}</p>
                                <ul className="list-disc list-inside text-sm space-y-1 pl-2">
                                  {intern.bullets.map((b, j) => <li key={j}>{b}</li>)}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="space-y-4">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Projects</h4>
                          {optimizedResume.projects.map((project, i) => (
                            <div key={i} className="space-y-1">
                              <div className="flex justify-between font-bold text-sm">
                                <span>{project.name}</span>
                                {project.link && <span className="text-blue-600 text-xs">Link</span>}
                              </div>
                              <p className="text-sm italic text-slate-600">{project.subtitle}</p>
                              {project.techStack && <p className="text-xs font-bold text-slate-700">Tech Stack: {project.techStack}</p>}
                              <ul className="list-disc list-inside text-sm space-y-1 pl-2">
                                {project.bullets.map((b, j) => <li key={j}>{b}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-4">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Education</h4>
                          {optimizedResume.education.map((edu, i) => (
                            <div key={i} className="space-y-1">
                              <div className="flex justify-between font-bold text-sm">
                                <span>{edu.school}</span>
                                <span>{edu.duration}</span>
                              </div>
                              <p className="text-sm">{edu.degree}</p>
                              <p className="text-sm font-medium">{edu.gpa}</p>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Certifications</h4>
                          <ul className="list-disc list-inside text-sm space-y-1 pl-2">
                            {optimizedResume.certifications.map((cert, i) => <li key={i}>{cert}</li>)}
                          </ul>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 pb-1">Interests</h4>
                          <p className="text-sm">• {optimizedResume.interests.join(', ')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Resume Editor Modal */}
      <AnimatePresence>
        {isEditing && editedResume && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditing(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-xl">
                    <Edit3 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Resume Editor</h2>
                    <p className="text-xs text-slate-500 font-medium">Modify your optimized resume before downloading</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Basic Info */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Full Name</label>
                    <input 
                      type="text" 
                      value={editedResume.name}
                      onChange={(e) => setEditedResume({ ...editedResume, name: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Contact Info</label>
                    <input 
                      type="text" 
                      value={editedResume.contact}
                      onChange={(e) => setEditedResume({ ...editedResume, contact: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    />
                  </div>
                </div>

                {/* Summary */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Professional Summary</label>
                  <textarea 
                    value={editedResume.summary}
                    onChange={(e) => setEditedResume({ ...editedResume, summary: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium resize-none"
                  />
                </div>

                {/* Technical Skills */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-2">Technical Skills</h4>
                  {editedResume.technicalSkills.map((group, i) => (
                    <div key={i} className="grid md:grid-cols-3 gap-4 items-start relative group">
                      <input 
                        type="text" 
                        value={group.category}
                        onChange={(e) => {
                          const newSkills = [...editedResume.technicalSkills];
                          newSkills[i].category = e.target.value;
                          setEditedResume({ ...editedResume, technicalSkills: newSkills });
                        }}
                        className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"
                        placeholder="Category"
                      />
                      <textarea 
                        value={group.skills.join(', ')}
                        onChange={(e) => {
                          const newSkills = [...editedResume.technicalSkills];
                          newSkills[i].skills = e.target.value.split(',').map(s => s.trim());
                          setEditedResume({ ...editedResume, technicalSkills: newSkills });
                        }}
                        className="md:col-span-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm min-h-[40px]"
                        placeholder="Skills (comma separated)"
                      />
                      <button 
                        onClick={() => {
                          const newSkills = editedResume.technicalSkills.filter((_, index) => index !== i);
                          setEditedResume({ ...editedResume, technicalSkills: newSkills });
                        }}
                        className="absolute -right-8 top-2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => setEditedResume({ ...editedResume, technicalSkills: [...editedResume.technicalSkills, { category: '', skills: [] }] })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    + Add Skill Category
                  </button>
                </div>

                {/* Internships */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-2">Internships</h4>
                  {editedResume.internships.map((intern, i) => (
                    <div key={i} className="p-4 border border-slate-100 rounded-2xl space-y-4 relative group">
                      <button 
                        onClick={() => {
                          const newInterns = editedResume.internships.filter((_, index) => index !== i);
                          setEditedResume({ ...editedResume, internships: newInterns });
                        }}
                        className="absolute -right-2 -top-2 p-2 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <div className="grid md:grid-cols-3 gap-4">
                        <input 
                          type="text" 
                          value={intern.title}
                          onChange={(e) => {
                            const newInterns = [...editedResume.internships];
                            newInterns[i].title = e.target.value;
                            setEditedResume({ ...editedResume, internships: newInterns });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"
                          placeholder="Title"
                        />
                        <input 
                          type="text" 
                          value={intern.company}
                          onChange={(e) => {
                            const newInterns = [...editedResume.internships];
                            newInterns[i].company = e.target.value;
                            setEditedResume({ ...editedResume, internships: newInterns });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Company"
                        />
                        <input 
                          type="text" 
                          value={intern.duration}
                          onChange={(e) => {
                            const newInterns = [...editedResume.internships];
                            newInterns[i].duration = e.target.value;
                            setEditedResume({ ...editedResume, internships: newInterns });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Duration"
                        />
                      </div>
                      <textarea 
                        value={intern.bullets.join('\n')}
                        onChange={(e) => {
                          const newInterns = [...editedResume.internships];
                          newInterns[i].bullets = e.target.value.split('\n');
                          setEditedResume({ ...editedResume, internships: newInterns });
                        }}
                        rows={3}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                        placeholder="Bullet points (one per line)"
                      />
                    </div>
                  ))}
                  <button 
                    onClick={() => setEditedResume({ ...editedResume, internships: [...editedResume.internships, { title: '', company: '', duration: '', bullets: [] }] })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    + Add Internship
                  </button>
                </div>

                {/* Projects */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-2">Projects</h4>
                  {editedResume.projects.map((project, i) => (
                    <div key={i} className="p-4 border border-slate-100 rounded-2xl space-y-4 relative group">
                      <button 
                        onClick={() => {
                          const newProjects = editedResume.projects.filter((_, index) => index !== i);
                          setEditedResume({ ...editedResume, projects: newProjects });
                        }}
                        className="absolute -right-2 -top-2 p-2 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <div className="grid md:grid-cols-2 gap-4">
                        <input 
                          type="text" 
                          value={project.name}
                          onChange={(e) => {
                            const newProjects = [...editedResume.projects];
                            newProjects[i].name = e.target.value;
                            setEditedResume({ ...editedResume, projects: newProjects });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"
                          placeholder="Project Name"
                        />
                        <input 
                          type="text" 
                          value={project.subtitle}
                          onChange={(e) => {
                            const newProjects = [...editedResume.projects];
                            newProjects[i].subtitle = e.target.value;
                            setEditedResume({ ...editedResume, projects: newProjects });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Subtitle"
                        />
                      </div>
                      <textarea 
                        value={project.bullets.join('\n')}
                        onChange={(e) => {
                          const newProjects = [...editedResume.projects];
                          newProjects[i].bullets = e.target.value.split('\n');
                          setEditedResume({ ...editedResume, projects: newProjects });
                        }}
                        rows={3}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                        placeholder="Bullet points (one per line)"
                      />
                    </div>
                  ))}
                  <button 
                    onClick={() => setEditedResume({ ...editedResume, projects: [...editedResume.projects, { name: '', subtitle: '', link: '', bullets: [] }] })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    + Add Project
                  </button>
                </div>

                {/* Education */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-2">Education</h4>
                  {editedResume.education.map((edu, i) => (
                    <div key={i} className="p-4 border border-slate-100 rounded-2xl space-y-4 relative group">
                      <button 
                        onClick={() => {
                          const newEdu = editedResume.education.filter((_, index) => index !== i);
                          setEditedResume({ ...editedResume, education: newEdu });
                        }}
                        className="absolute -right-2 -top-2 p-2 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <div className="grid md:grid-cols-2 gap-4">
                        <input 
                          type="text" 
                          value={edu.school}
                          onChange={(e) => {
                            const newEdu = [...editedResume.education];
                            newEdu[i].school = e.target.value;
                            setEditedResume({ ...editedResume, education: newEdu });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"
                          placeholder="University"
                        />
                        <input 
                          type="text" 
                          value={edu.degree}
                          onChange={(e) => {
                            const newEdu = [...editedResume.education];
                            newEdu[i].degree = e.target.value;
                            setEditedResume({ ...editedResume, education: newEdu });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Degree"
                        />
                      </div>
                      <div className="grid md:grid-cols-2 gap-4">
                        <input 
                          type="text" 
                          value={edu.duration}
                          onChange={(e) => {
                            const newEdu = [...editedResume.education];
                            newEdu[i].duration = e.target.value;
                            setEditedResume({ ...editedResume, education: newEdu });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Duration"
                        />
                        <input 
                          type="text" 
                          value={edu.gpa}
                          onChange={(e) => {
                            const newEdu = [...editedResume.education];
                            newEdu[i].gpa = e.target.value;
                            setEditedResume({ ...editedResume, education: newEdu });
                          }}
                          className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="GPA"
                        />
                      </div>
                    </div>
                  ))}
                  <button 
                    onClick={() => setEditedResume({ ...editedResume, education: [...editedResume.education, { school: '', degree: '', duration: '', gpa: '' }] })}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    + Add Education
                  </button>
                </div>

                {/* Certifications */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Certifications</label>
                  <textarea 
                    value={editedResume.certifications.join('\n')}
                    onChange={(e) => setEditedResume({ ...editedResume, certifications: e.target.value.split('\n') })}
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    placeholder="Certifications (one per line)"
                  />
                </div>

                {/* Interests */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Interests</label>
                  <input 
                    type="text" 
                    value={editedResume.interests.join(', ')}
                    onChange={(e) => setEditedResume({ ...editedResume, interests: e.target.value.split(',').map(s => s.trim()) })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    placeholder="Interests (comma separated)"
                  />
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-4">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Re-scoring...
                    </>
                  ) : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
