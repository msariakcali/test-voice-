document.addEventListener('DOMContentLoaded', () => {
    const startRecordButton = document.getElementById('start-recording');
    const stopRecordButton = document.getElementById('stop-recording');
    const chatMessages = document.getElementById('chat-messages');
    const statusElement = document.getElementById('status');
    const responseAudio = document.getElementById('response-audio');
    const continuousModeToggle = document.getElementById('continuous-mode');

    let isListening = false;
    let recognizing = false;
    let recognition = null;
    let finalTranscript = '';
    let interimTranscript = '';
    let silenceTimeout = null;
    let silenceTimer = 2000; // 2 saniye sessizlik algılama
    let processingResponse = false;
    let lastSpeechTime = 0;
    
    // Web Speech API desteklenmiyor mu kontrolü
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        statusElement.textContent = 'Tarayıcınız canlı konuşma tanıma özelliğini desteklemiyor. Lütfen Chrome veya Edge kullanın.';
        statusElement.className = 'status error';
        startRecordButton.disabled = true;
        return;
    }
    
    // Web Speech API için yapılandırma
    function setupRecognition() {
        // Eğer zaten bir tanıma nesnesi varsa, olayları temizle
        if (recognition) {
            recognition.onresult = null;
            recognition.onend = null;
            recognition.onerror = null;
            recognition.onstart = null;
            recognition = null;
        }
        
        // Yeni bir tanıma nesnesi oluştur
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'tr-TR';
        recognition.maxAlternatives = 1;
        
        // Konuşma tanıma olayları
        recognition.onstart = function() {
            recognizing = true;
            console.log('Konuşma tanıma başladı');
            lastSpeechTime = Date.now(); // Son konuşma zamanını başlangıçta ayarla
        };
        
        recognition.onerror = function(event) {
            console.error('Konuşma tanıma hatası:', event.error);
            
            if (event.error === 'no-speech') {
                statusElement.textContent = 'Konuşma algılanmadı. Lütfen mikrofona konuştuğunuzdan emin olun.';
            } else if (event.error === 'audio-capture') {
                statusElement.textContent = 'Mikrofon bulunamadı. Lütfen mikrofonunuzu kontrol edin.';
            } else if (event.error === 'not-allowed') {
                statusElement.textContent = 'Mikrofon erişimine izin verilmedi. Lütfen tarayıcı izinlerini kontrol edin.';
            } else {
                statusElement.textContent = 'Konuşma tanıma hatası: ' + event.error;
            }
            
            statusElement.className = 'status error';
            
            // Dinlemeyi sıfırla
            isListening = false;
            recognizing = false;
            startRecordButton.innerHTML = '<span class="icon">🎤</span> Konuşmaya Başla';
        };
        
        recognition.onend = function() {
            recognizing = false;
            console.log('Konuşma tanıma sonlandı');
            
            if (isListening && !processingResponse) {
                try {
                    // Dinleme durumunda devam etmesini sağla (otomatik yeniden başlatma Chrome'da gerekebilir)
                    recognition.start();
                } catch (e) {
                    console.error('Konuşma tanımayı yeniden başlatma hatası:', e);
                }
            }
        };
        
        recognition.onresult = function(event) {
            // Son konuşma zamanını güncelle
            lastSpeechTime = Date.now();
            
            // Sessizlik zamanlayıcısını sıfırla
            if (silenceTimeout) {
                clearTimeout(silenceTimeout);
            }
            
            // Geçici transkripti temizle
            interimTranscript = '';
            
            // Sonuçları işle
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                    console.log('Final konuşma:', finalTranscript);
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            // Göster
            const tempMessage = document.getElementById('temp-message');
            if (tempMessage) {
                tempMessage.textContent = finalTranscript + interimTranscript;
            }
            
            // Sessizlik kontrolünü başlat
            startSilenceDetection();
        };
    }
    
    // Sürekli mod değişimini dinle
    continuousModeToggle.addEventListener('change', function() {
        if (this.checked) {
            statusElement.textContent = 'Sürekli konuşma modu açık. İstediğiniz zaman konuşabilirsiniz.';
        } else {
            statusElement.textContent = 'Sürekli konuşma modu kapalı. Konuşmak için mikrofon butonuna basın.';
        }
    });

    // Mikrofon kaydını başlat
    startRecordButton.addEventListener('click', () => {
        if (processingResponse) return; // İşlem devam ediyorsa yeni kayıt başlatma
        
        if (!isListening) {
            startListening();
        } else {
            stopListening(true); // Manuel durdurma
        }
    });

    // Dinlemeyi başlat
    function startListening() {
        try {
            setupRecognition(); // Her seferinde tanıma nesnesini yeniden oluştur
            
            finalTranscript = '';
            interimTranscript = '';
            recognition.start();
            isListening = true;
            
            // UI güncellemeleri
            startRecordButton.innerHTML = '<span class="icon">⏹️</span> Dinlemeyi Durdur';
            stopRecordButton.disabled = true;
            statusElement.textContent = 'Dinliyorum... Konuşmaya başlayabilirsiniz.';
            statusElement.className = 'status recording';
            
            // Dinleme başladığında geçici mesaj ekle
            const tempMessageDiv = document.createElement('div');
            tempMessageDiv.id = 'temp-message';
            tempMessageDiv.className = 'message user temp';
            chatMessages.appendChild(tempMessageDiv);
            
            // Otomatik kaydırma
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
        } catch (error) {
            console.error('Konuşma tanıma hatası:', error);
            statusElement.textContent = 'Mikrofon erişimi sağlanamadı: ' + error.message;
            statusElement.className = 'status error';
            isListening = false;
        }
    }
    
    // Sessizlik algılama başlat
    function startSilenceDetection() {
        // Önceki sessizlik zamanlayıcısını temizle
        if (silenceTimeout) {
            clearTimeout(silenceTimeout);
        }
        
        // Yeni zamanlayıcı ayarla
        silenceTimeout = setTimeout(() => {
            const currentTime = Date.now();
            const silenceDuration = currentTime - lastSpeechTime;
            
            console.log(`Sessizlik süresi: ${silenceDuration}ms`);
            
            // Eğer belirli bir süre sessizlik varsa ve konuşma algılandıysa
            if (isListening && silenceDuration >= silenceTimer && 
                (finalTranscript.trim() !== '' || interimTranscript.trim() !== '')) {
                
                console.log('Sessizlik algılandı, konuşma işleniyor...');
                
                // Interim transcript'i final transcript'e ekle eğer son bir parça kaldıysa
                if (interimTranscript.trim() !== '') {
                    finalTranscript += interimTranscript;
                }
                
                // Konuşma bitti, işleme başla
                stopListening(false);
                processResult();
            }
        }, silenceTimer);
    }
    
    // Dinlemeyi durdur
    function stopListening(isManual = false) {
        try {
            if (recognition) {
                recognition.stop();
            }
            isListening = false;
            
            if (silenceTimeout) {
                clearTimeout(silenceTimeout);
                silenceTimeout = null;
            }
            
            // UI güncellemeleri
            startRecordButton.innerHTML = '<span class="icon">🎤</span> Konuşmaya Başla';
            stopRecordButton.disabled = true;
            
            // Eğer hiç konuşma algılanmadıysa ve manuel durdurulmuşsa
            if (finalTranscript.trim() === '' && interimTranscript.trim() === '' && isManual) {
                statusElement.textContent = 'Konuşma algılanmadı.';
                statusElement.className = 'status';
                
                // Geçici mesajı kaldır
                const tempMessage = document.getElementById('temp-message');
                if (tempMessage) {
                    tempMessage.remove();
                }
            }
            
        } catch (error) {
            console.error('Konuşma tanıma durdurma hatası:', error);
        }
    }
    
    // Sonuç işleme
    function processResult() {
        processingResponse = true;
        
        // Geçici mesajı kaldır
        const tempMessage = document.getElementById('temp-message');
        if (tempMessage) {
            tempMessage.remove();
        }
        
        if (finalTranscript.trim() === '') {
            console.log('İşlenecek metin yok, dinleme yeniden başlatılıyor');
            statusElement.textContent = 'Konuşma algılanmadı, yeniden dinleniyor...';
            
            setTimeout(() => {
                processingResponse = false;
                if (continuousModeToggle.checked) {
                    startListening();
                }
            }, 1000);
            
            return;
        }
        
        // Mesajı göster
        const processedText = finalTranscript.trim();
        addMessage('user', processedText);
        
        // Durum mesajını güncelle
        statusElement.textContent = 'Yanıt alınıyor...';
        statusElement.className = 'status thinking';
        
        // AI yanıtı al
        getAIResponse(processedText);
    }
    
    // AI yanıtını al
    async function getAIResponse(text) {
        try {
            console.log("AI'ya gönderilen metin:", text);
            
            const response = await fetch('/get-ai-response', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: text })
            });
            
            console.log("AI yanıt durum kodu:", response.status);
            
            if (!response.ok) {
                throw new Error(`Sunucu yanıt hatası: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log("AI'dan gelen yanıt:", data);
            
            if (data.error) {
                addMessage('system', 'Hata: ' + data.error);
                statusElement.textContent = 'Hata: ' + data.error;
                statusElement.className = 'status error';
                processingResponse = false;
                
                // Hata durumunda bile sürekli modda devam et
                if (continuousModeToggle.checked) {
                    setTimeout(() => {
                        startListening();
                    }, 2000);
                }
                
                return;
            }
            
            // AI yanıtını ekrana ekle
            addMessage('assistant', data.text);
            
            // Ses yanıtını oynat
            if (data.audio_url) {
                console.log("Oynatılacak ses URL:", data.audio_url);
                responseAudio.src = data.audio_url;
                
                // Ses yükleme ve oynatma için Promise kullan
                try {
                    await new Promise((resolve, reject) => {
                        responseAudio.onloadeddata = () => {
                            console.log("Ses dosyası yüklendi, oynatılıyor...");
                            
                            // Ses oynatma için promise
                            responseAudio.play()
                                .then(resolve)
                                .catch(e => {
                                    console.error("Ses oynatma hatası:", e);
                                    reject(e);
                                });
                        };
                        
                        responseAudio.onerror = (e) => {
                            console.error("Ses dosyası yüklenirken hata:", e);
                            reject(new Error("Ses dosyası yüklenemedi"));
                        };
                    });
                    
                    // Sesin bitmesini bekle
                    await new Promise(resolve => {
                        responseAudio.onended = () => {
                            console.log("Ses yanıtı tamamlandı");
                            resolve();
                        };
                    });
                    
                } catch (audioError) {
                    console.error("Ses işleme hatası:", audioError);
                    statusElement.textContent = 'Ses oynatılamadı: ' + audioError.message;
                }
                
                // Sürekli modda otomatik olarak yeniden dinlemeye başla
                if (continuousModeToggle.checked) {
                    statusElement.textContent = 'Yanıt tamamlandı. Dinlemeye devam ediyorum...';
                    setTimeout(() => {
                        startListening();
                    }, 1000);
                } else {
                    // Sürekli mod kapalıysa, manuel kayıt için hazırlan
                    statusElement.textContent = 'Yanıt tamamlandı. Konuşmak için mikrofon butonuna basın.';
                    statusElement.className = 'status';
                }
                
            } else {
                console.error("Ses URL'si alınamadı");
                statusElement.textContent = 'Ses yanıtı oluşturulamadı';
                
                // Ses yoksa bile sürekli modda devam et
                if (continuousModeToggle.checked) {
                    setTimeout(() => {
                        startListening();
                    }, 2000);
                }
            }
            
        } catch (error) {
            console.error('AI yanıt hatası:', error);
            statusElement.textContent = 'Bir hata oluştu: ' + error.message;
            statusElement.className = 'status error';
            
            // Hata durumunda bile sürekli modda devam et
            if (continuousModeToggle.checked) {
                setTimeout(() => {
                    startListening();
                }, 2000);
            }
            
        } finally {
            processingResponse = false;
        }
    }
    
    // Mesaj ekleme fonksiyonu
    function addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        
        messageDiv.appendChild(paragraph);
        chatMessages.appendChild(messageDiv);
        
        // Otomatik aşağı kaydır
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Başlangıçta sürekli mod aktifse otomatik başlat
    if (continuousModeToggle.checked) {
        setTimeout(() => {
            startListening();
        }, 1000);
    }
});