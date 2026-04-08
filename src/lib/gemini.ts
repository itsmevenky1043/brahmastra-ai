import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export interface SectionBreakdown {
  section: string;
  percentage: number;
}

export interface OptimizedResume {
  name: string;
  contact: string;
  summary: string;
  technicalSkills: { category: string; skills: string[] }[];
  internships: { title: string; company: string; duration: string; bullets: string[] }[];
  projects: { name: string; subtitle: string; link: string; bullets: string[]; techStack?: string }[];
  education: { school: string; degree: string; duration: string; gpa: string }[];
  certifications: string[];
  interests: string[];
  templateId: 'template_1' | 'template_2';
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

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const is503 = error?.status === 503 || error?.message?.includes("503") || error?.message?.includes("high demand");
    if (is503 && retries > 0) {
      console.log(`Model high demand. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function analyzeResume(resumeText: string, jdText: string): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('API Key is not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY in your environment variables.');
  }

  return await withRetry(async () => {
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
  });
}

export interface UserPreferences {
  preferredTone: string;
  preferredTemplate: string;
}

export const RESUME_TEMPLATES = {
  template_1: `
[FULL NAME]
[LOCATION] — [PHONE]
[EMAIL]
[LINKS: LinkedIn, Github, Portfolio, etc.]

Professional Summary
[A compelling 3-4 sentence summary highlighting key achievements and alignment with the JD.]

Technical Skills
• [CATEGORY 1]: [SKILL 1], [SKILL 2], ...
• [CATEGORY 2]: [SKILL 1], [SKILL 2], ...
...

Projects
[PROJECT NAME] [LINK]
[PUBLISHED INFO / SUBTITLE]
• [Impactful bullet point using action verbs and metrics]
• [Impactful bullet point using action verbs and metrics]
...

Education
[UNIVERSITY NAME]
[DEGREE NAME] [DATES]
[CGPA/GPA]

Certifications
• [CERTIFICATION NAME]
...

Interests
• [INTEREST 1], [INTEREST 2]
`,
  template_2: `
[FULL NAME]
[LOCATION] | [EMAIL] | [PHONE] |
[LINKS: LinkedIn, Github, Portfolio, etc.]

Summary
[A concise summary focused on technical expertise and value proposition.]

Technical Skills
• [CATEGORY 1]: [SKILL 1], [SKILL 2], ...
• [CATEGORY 2]: [SKILL 1], [SKILL 2], ...
...

Projects
[PROJECT NAME] [LINK]
[PUBLISHED INFO / SUBTITLE]
Tech Stack: [List of technologies used]
• [Impactful bullet point using action verbs and metrics]
• [Impactful bullet point using action verbs and metrics]
...

Education
• [UNIVERSITY NAME]: [DEGREE NAME] [DATES]
[CGPA/GPA]

Certifications
• [CERTIFICATION NAME]
...
`
};

export async function optimizeResume(
  resumeText: string, 
  jdText: string, 
  analysis: AnalysisResult,
  preferences?: UserPreferences
): Promise<OptimizedResume> {
  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are an expert ATS resume optimizer and recruiter.

Your task is to improve a candidate's resume based on a given job description and ATS analysis.

IMPORTANT RULES:
1. You MUST strictly use ONLY the provided resume structure.
2. Do NOT add fake experience or skills.
3. Only include skills that are relevant and can be reasonably inferred.
4. The section order MUST be: Summary, Technical Skills, Internships (if any), Projects, Education, Certifications, Interests.
5. Follow HackerRank resume format guidelines: use concise, impact-driven bullet points (Action Verb + Task + Result).
6. Ensure each bullet point is concise (ideally 1 line, max 2 lines) to prevent PDF overflow and maintain a clean layout.
7. Balance the content across sections to ensure the resume fits perfectly on 1 page (or matches the original page count).

INPUTS:
1. Original Resume:
${resumeText}

2. Job Description:
${jdText}

3. Missing Skills Identified:
${analysis.missingSkills.join(", ")}

4. ATS Score:
${analysis.atsScore}

TASK:
- Analyze the resume against the job description.
- Select the MOST suitable template style (Template 1: Classic with em-dash, Template 2: Modern with pipes).
- Rewrite the resume content to maximize ATS score (target >85%).
- If the current ATS score is less than 85, you MUST:
  1. Add the missing technical skills identified from the JD to the 'Technical Skills' section.
  2. Add ONE new project to the 'Projects' section that specifically demonstrates the use of these new technical skills from the JD. Ensure this project is realistic based on the candidate's background.
- Improve bullet points using strong action verbs.
- Align skills with job description keywords.

OUTPUT REQUIREMENTS:
- Return the optimized resume in JSON format matching the schema below.

SCHEMA:
{
  "name": "Full Name",
  "contact": "Location | Email | Phone | Links",
  "summary": "3-4 sentence professional summary",
  "technicalSkills": [
    { "category": "Programming Languages", "skills": ["Python", "Java"] }
  ],
  "internships": [
    { "title": "Role", "company": "Company", "duration": "Dates", "bullets": ["..."] }
  ],
  "projects": [
    { "name": "Project Name", "subtitle": "Subtitle/Journal", "link": "URL", "bullets": ["..."], "techStack": "Optional tech list" }
  ],
  "education": [
    { "school": "University", "degree": "Degree", "duration": "Dates", "gpa": "CGPA: X.X" }
  ],
  "certifications": ["Cert 1", "Cert 2"],
  "interests": ["Interest 1", "Interest 2"],
  "templateId": "template_1" or "template_2"
}`
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
            technicalSkills: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  skills: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["category", "skills"]
              }
            },
            internships: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  company: { type: Type.STRING },
                  duration: { type: Type.STRING },
                  bullets: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["title", "company", "duration", "bullets"]
              }
            },
            projects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  link: { type: Type.STRING },
                  bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                  techStack: { type: Type.STRING }
                },
                required: ["name", "subtitle", "link", "bullets"]
              }
            },
            education: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  school: { type: Type.STRING },
                  degree: { type: Type.STRING },
                  duration: { type: Type.STRING },
                  gpa: { type: Type.STRING }
                },
                required: ["school", "degree", "duration", "gpa"]
              }
            },
            certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
            interests: { type: Type.ARRAY, items: { type: Type.STRING } },
            templateId: { type: Type.STRING, enum: ["template_1", "template_2"] }
          },
          required: ["name", "contact", "summary", "technicalSkills", "internships", "projects", "education", "certifications", "interests", "templateId"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
}
