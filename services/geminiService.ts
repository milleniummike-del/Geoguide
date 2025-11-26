import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Decode base64 audio helper
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const generateStopInfo = async (placeName: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Good balance of speed/quality
      contents: `Provide a short, engaging description (under 50 words) for a travel guide stop named "${placeName}". Also, provide its approximate latitude and longitude if known, otherwise estimate near Paris.`,
      config: {
        tools: [{ googleMaps: {} }], // Grounding for real location data
      }
    });

    const text = response.text;
    
    // Extract grounding data if available for coordinates
    let lat = 48.8566; // Default
    let lng = 2.3522;
    const grounding = response.candidates?.[0]?.groundingMetadata;
    
    // Simple heuristic to see if grounding gave us a specific place (this is simplified as the API structure varies based on query)
    // For this demo, we will rely on the text or a specific regex parse if grounding isn't directly giving explicit lat/lng in a simple prop.
    // However, let's try to ask Gemini to output JSON to be safer about coordinates if we didn't use grounding.
    // BUT, since we used grounding, let's try to use the Tool response or just re-ask for JSON.
    
    // Strategy: Two-pass or specific prompt for JSON if grounding is tricky to parse directly without complex types.
    // Let's refine the prompt to ask for JSON directly to make it robust for the app.
    
    return {
      description: text || "No description available.",
      // In a real app, we'd parse the grounding metadata specifically or use the Places API. 
      // Here we will return the text and let the user refine coords, or use a second call for JSON.
      // Let's do a second lightweight call for JSON structure if needed, or just return text.
      rawResponse: text
    };
  } catch (error) {
    console.error("Gemini Error:", error);
    return { description: "Could not generate description.", rawResponse: "" };
  }
};

export const generateStopDetailsJSON = async (placeName: string) => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Identify the famous place "${placeName}". Return a JSON object with properties: 'description' (string, max 50 words), 'lat' (number), 'lng' (number). If location is unknown, use Paris coordinates.`,
            config: {
                responseMimeType: "application/json"
            }
        });
        return JSON.parse(response.text || "{}");
    } catch (e) {
        console.error("Gemini JSON Error", e);
        return { description: "Error generating details.", lat: 48.85, lng: 2.35 };
    }
}

export const generateAudioGuide = async (text: string): Promise<AudioBuffer | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }, // 'Aoede' is a good guide voice
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(decode(base64Audio).buffer);
    return audioBuffer;

  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};

export const playAudioBuffer = (buffer: AudioBuffer) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
};