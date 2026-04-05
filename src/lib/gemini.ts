import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface SectionBreakdown {
  section: string;
  percentage: number;
}

export interface OptimizedResume {
  name: string;
  contact: string;
  summary: string;
  experience: {
    title: string;
    company: string;
    duration: string;
    bullets: string[];
  }[];
  education: {
    degree: string;
    school: string;
    year: string;
  }[];
  skills: string[];
  projects: {
    name: string;
    description: string;
    bullets: string[];
  }[];
}

export interface AnalysisResult {
  atsScore: number;
  matchPercentage: number;
  skillMatch: number;
  keywordMatch: number;
  resumeQuality: number;
  missingSkills: string[];
  extractedSkills: string[];
  jdSkills: string[];
  suggestions: string;
  summary: string[];
  sectionBreakdown: SectionBreakdown[];
}

export async function analyzeResume(resumeText: string, jdText: string): Promise<AnalysisResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are an expert ATS (Applicant Tracking System) and Recruiter. 
            Analyze the following Resume against the Job Description (JD).
            
            RESUME:
            ${resumeText}
            
            JOB DESCRIPTION:
            ${jdText}
            
            Provide a detailed analysis in JSON format with the following schema:
            - atsScore: number (0-100). Calculate this using the formula: (0.5 * skillMatch) + (0.3 * keywordMatch) + (0.2 * resumeQuality)
            - matchPercentage: number (0-100)
            - skillMatch: number (0-100)
            - keywordMatch: number (0-100)
            - resumeQuality: number (0-100)
            - missingSkills: string[] (skills present in JD but missing in Resume. List them concisely.)
            - extractedSkills: string[] (skills found in Resume. List them concisely.)
            - jdSkills: string[] (key skills extracted from JD. Identify and extract both 'soft skills' (e.g., leadership, communication) and 'technical skills' (e.g., programming, tools) separately from the job description and include them in this array. Prioritize skills mentioned in sections like 'Requirements', 'Qualifications', or 'Skills Needed'. List them concisely.)
            - suggestions: string (markdown format, provide actionable tips to improve the resume for this JD. Use clear bullet points and bold headings. Avoid long paragraphs. Make it neat and easy to read.)
            - summary: string[] (3-4 key bullet points summarizing the match. Keep each point concise and professional.)
            - sectionBreakdown: { section: string, percentage: number }[] (breakdown of resume sections like Experience, Education, Skills, Projects, etc. and their relative length/weight in the resume, total should be 100)
            `
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          atsScore: { type: Type.NUMBER },
          matchPercentage: { type: Type.NUMBER },
          skillMatch: { type: Type.NUMBER },
          keywordMatch: { type: Type.NUMBER },
          resumeQuality: { type: Type.NUMBER },
          missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          extractedSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          jdSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { type: Type.STRING },
          summary: { type: Type.ARRAY, items: { type: Type.STRING } },
          sectionBreakdown: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                section: { type: Type.STRING },
                percentage: { type: Type.NUMBER },
              },
              required: ["section", "percentage"],
            },
          },
        },
        required: [
          "atsScore", "matchPercentage", "skillMatch", "keywordMatch", 
          "resumeQuality", "missingSkills", "extractedSkills", "jdSkills", 
          "suggestions", "summary", "sectionBreakdown"
        ]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export interface UserPreferences {
  preferredTone: string;
  preferredTemplate: string;
}

export async function optimizeResume(
  resumeText: string, 
  jdText: string, 
  analysis: AnalysisResult,
  preferences?: UserPreferences
): Promise<OptimizedResume> {
  const tone = preferences?.preferredTone || "Professional";
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are an expert Resume Optimizer. 
            Rewrite the following Resume to achieve a high ATS score (above 90) for the provided Job Description.
            
            ORIGINAL RESUME:
            ${resumeText}
            
            JOB DESCRIPTION:
            ${jdText}
            
            ANALYSIS RESULTS:
            - Missing Skills: ${analysis.missingSkills.join(", ")}
            - Suggestions: ${analysis.suggestions}
            
            INSTRUCTIONS:
            1. Rewrite bullet points using strong action verbs (e.g., "Developed", "Spearheaded", "Optimized").
            2. Incorporate missing skills naturally where relevant.
            3. Align content with JD keywords.
            4. Keep the structure professional and concise.
            5. Use a ${tone} tone throughout the resume.
            6. Return the optimized content in JSON format.
            
            SCHEMA:
            {
              "name": "Full Name",
              "contact": "Email | Phone | LinkedIn",
              "summary": "Professional summary optimized for the JD",
              "experience": [
                {
                  "title": "Job Title",
                  "company": "Company Name",
                  "duration": "Dates",
                  "bullets": ["Action-oriented bullet points..."]
                }
              ],
              "education": [
                {
                  "degree": "Degree Name",
                  "school": "University Name",
                  "year": "Graduation Year"
                }
              ],
              "skills": ["List of technical and soft skills"],
              "projects": [
                {
                  "name": "Project Name",
                  "description": "Brief description",
                  "bullets": ["Action-oriented bullet points..."]
                }
              ]
            }
            `
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          contact: { type: Type.STRING },
          summary: { type: Type.STRING },
          experience: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                company: { type: Type.STRING },
                duration: { type: Type.STRING },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["title", "company", "duration", "bullets"],
            },
          },
          education: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                degree: { type: Type.STRING },
                school: { type: Type.STRING },
                year: { type: Type.STRING },
              },
              required: ["degree", "school", "year"],
            },
          },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          projects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["name", "description", "bullets"],
            },
          },
        },
        required: ["name", "contact", "summary", "experience", "education", "skills", "projects"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
