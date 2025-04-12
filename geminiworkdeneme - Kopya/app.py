import os
import time
import uuid
import json
from flask import Flask, render_template, request, jsonify
import google.generativeai as genai
from google.cloud import texttospeech
from google.cloud import speech
import base64
from pydub import AudioSegment
import tempfile
from dotenv import load_dotenv

# Hata ayıklama için
import traceback
import sys

# .env dosyasını yükle (eğer varsa)
load_dotenv()
print("Ortam değişkenleri .env dosyasından yükleniyor...")

# Flask uygulamasını başlat
app = Flask(__name__)

# Ses dosyalarının saklanacağı dizin
AUDIO_DIR = os.path.join('static', 'audio')
os.makedirs(AUDIO_DIR, exist_ok=True)

# Google Cloud kimlik bilgilerini hazırla
credentials_found = False
try:
    # Doğrudan belirtilen kimlik dosyası
    credentials_path = ""
    if os.path.exists(credentials_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path
        print(f"Google Cloud kimlik dosyası direkt yoldan yüklendi: {credentials_path}")
        credentials_found = True
    
    # .env dosyasından kimlik dosyası yolunu kontrol et
    if not credentials_found and "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
        cred_path = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]
        if os.path.exists(cred_path):
            print(f"Google Cloud kimlik dosyası .env'den yüklendi: {cred_path}")
            credentials_found = True
    
    # Ana klasördeki json dosyasını ara (Yedek yöntem)
    if not credentials_found:
        for file in os.listdir('.'):
            if file.endswith('.json') and ('credentials' in file.lower() or 'key' in file.lower() or 'service' in file.lower() or 'united-planet' in file.lower()):
                credentials_path = os.path.abspath(file)
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path
                print(f"Google Cloud kimlik dosyası klasörden bulundu: {credentials_path}")
                credentials_found = True
                break
    
    # Kimlik bilgilerini kontrol et
    if not credentials_found:
        print("UYARI: Google Cloud kimlik dosyası bulunamadı. Lütfen credentials.json dosyasını proje dizinine ekleyin.")
        print("TTS ve Speech-to-Text özellikleri çalışmayabilir.")
except Exception as e:
    print(f"Kimlik dosyası yükleme hatası: {str(e)}")
    traceback.print_exc(file=sys.stdout)

# Gemini API ayarları
model = None
try:
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        print(f"Gemini API anahtarı .env dosyasından yüklendi: {api_key[:5]}...{api_key[-5:]}")
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.0-flash')
        print("Gemini modeli başarıyla yapılandırıldı")
    else:
        print("UYARI: Gemini API anahtarı bulunamadı. .env dosyasına GEMINI_API_KEY değişkenini ekleyin.")
except Exception as e:
    print(f"Gemini API yapılandırma hatası: {str(e)}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/recognize-speech', methods=['POST'])
def recognize_speech():
    """Web Speech API kullanıldığı için bu endpoint artık kullanılmayacak"""
    return jsonify({"error": "Bu endpoint artık Web Speech API ile değiştirildi"})

@app.route('/get-ai-response', methods=['POST'])
def get_ai_response():
    print("\n--- YENİ AI YANITI İSTEĞİ ---")
    user_message = request.json.get('text')
    
    if not user_message or user_message.strip() == "":
        print("Hata: Boş mesaj alındı")
        return jsonify({"error": "Boş mesaj gönderildi"})
    
    print(f"Kullanıcı mesajı: {user_message}")
    
    try:
        # 1. Gemini API'ye sorguyu gönder
        print("1. Gemini API'ye istek gönderiliyor...")
        
        # Prompt şablonu - Türkçe sesli asistan için talimatlar
        prompt_template = """
        Sen Türkçe konuşan bir sesli asistansın. Adın ORBIT.Seni NCT Robotics geliştirdi.
        Kullanıcıyla Türkçe olarak doğal bir şekilde konuşmalısın.
        Cevapların kısa, anlaşılır ve öz olsun.
        Sesli iletişim için uygun, doğal cümleler kullan.
        
        Kullanıcı şunu söyledi: {user_message}
        """
        
        # Kullanıcı mesajını prompt şablonuna ekleyin
        prompt = prompt_template.format(user_message=user_message)
        print(f"Oluşturulan prompt:\n{prompt}")
        
        generation_config = {
            "temperature": 0.7,
            "top_p": 0.9,
            "top_k": 40,
            "max_output_tokens": 1024,
        }
        
        safety_settings = [
            {
                "category": "HARM_CATEGORY_HARASSMENT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_HATE_SPEECH",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            }
        ]
        
        try:
            if not model:
                raise Exception("Gemini model yüklenemedi. API anahtarınızı kontrol edin.")
                
            # Doğrudan kullanıcı mesajı yerine hazırlanmış prompt'u kullanın
            response = model.generate_content(
                prompt,
                generation_config=generation_config,
                safety_settings=safety_settings
            )
            
            if not hasattr(response, 'text'):
                print("Gemini API yanıtı beklenen formatta değil:", response)
                return jsonify({"error": "Yapay zeka yanıt üretemedi, yanıt formatı uyumsuz."})
                
            ai_response = response.text
            print(f"Gemini yanıtı alındı ({len(ai_response)} karakter)")
            
            if not ai_response or ai_response.strip() == "":
                return jsonify({"error": "Yapay zeka yanıt üretemedi. Lütfen farklı bir soru sorun."})
        except Exception as e:
            print(f"Gemini API hatası: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return jsonify({"error": f"Yapay zeka yanıt üretemedi: {str(e)}"})
        
        # 2. Text-to-Speech dönüşümü
        print("2. Text-to-Speech dönüşümü yapılıyor...")
        
        try:
            if not credentials_found:
                # TTS kimlik bilgileri yoksa sadece metin yanıtı gönder
                print("Google Cloud kimlik bilgileri bulunamadığı için sesli yanıt atlanıyor.")
                return jsonify({
                    "text": ai_response,
                    "warning": "Google Cloud kimlik bilgileri bulunamadı, sesli yanıt oluşturulamadı."
                })
            
            client = texttospeech.TextToSpeechClient()
            
            # Ayarlanabilir ses parametreleri
            pitch = 0.0  # Normalde 0, -20.0 ile 20.0 arasında
            speaking_rate = 1.0  # Normalde 1, 0.25 ile 4.0 arasında
            
            synthesis_input = texttospeech.SynthesisInput(text=ai_response)
            
            # Kullanılabilir Türkçe seslerini bul
            voice_name = None
            try:
                voices = client.list_voices(language_code="tr-TR")
                available_voices = [v.name for v in voices.voices]
                print(f"Mevcut Türkçe sesler: {available_voices}")
                
                # Tercih edilen sesler sırasıyla
                preferred_voices = [
                    "tr-TR-Chirp3-HD-Kore"
                ]
                
                # Tercih edilen seslerden mevcut olanını bul
                for pv in preferred_voices:
                    if pv in available_voices:
                        voice_name = pv
                        print(f"Tercih edilen ses bulundu: {voice_name}")
                        break
                
                # Tercih edilen ses yoksa ilk mevcut sesi kullan
                if not voice_name and available_voices:
                    voice_name = available_voices[0]
                    print(f"İlk mevcut ses kullanılacak: {voice_name}")
            except Exception as e:
                print(f"Ses listesi alınırken hata: {str(e)}")
            
            # Ses seçimi
            if voice_name:
                voice = texttospeech.VoiceSelectionParams(
                    language_code="tr-TR",
                    name=voice_name
                )
            else:
                # Fallback: Sadece dil kodu belirt
                voice = texttospeech.VoiceSelectionParams(
                    language_code="tr-TR"
                )
            
            # Ses konfigürasyonu
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=speaking_rate,
                pitch=pitch
            )
            
            # TTS isteği
            tts_response = client.synthesize_speech(
                input=synthesis_input, voice=voice, audio_config=audio_config
            )
            
            # Başarılı mı kontrol et
            if not tts_response.audio_content:
                raise Exception("TTS yanıtı ses içeriği boş geldi")
                
            # Yanıt ses dosyasını kaydet
            audio_filename = f"response_{uuid.uuid4()}.mp3"
            audio_path = os.path.join(AUDIO_DIR, audio_filename)
            
            with open(audio_path, 'wb') as out:
                out.write(tts_response.audio_content)
            
            audio_url = f"/static/audio/{audio_filename}"
            print(f"3. Ses dosyası oluşturuldu: {audio_path}")
            
            # Başarılı yanıt
            return jsonify({
                "text": ai_response,
                "audio_url": audio_url
            })
            
        except Exception as e:
            print(f"TTS hatası: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            
            # TTS hatası durumunda sadece metin yanıtı gönder
            return jsonify({
                "text": ai_response,
                "error": f"Sesli yanıt oluşturulamadı: {str(e)}"
            })
    
    except Exception as e:
        print(f"Genel hata: {str(e)}")
        traceback.print_exc(file=sys.stdout)
        return jsonify({"error": str(e)})

if __name__ == '__main__':
    app.run(debug=True)