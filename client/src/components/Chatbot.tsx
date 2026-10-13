import React, { useState, useRef, useEffect } from 'react';
import { useRouting } from '../context/RoutingContext';

interface ChatMessage {
  sender: 'bot' | 'user';
  text: string;
  metadata?: any;
}

export const Chatbot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'bot',
      text: "Hi! I'm LifeLink AI. I can answer questions about blood donation or help you create an emergency request. How can I help?",
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const { navigateTo } = useRouting();

  // Conversation persistence
  const [conversationId, setConversationId] = useState<string>('');
  
  useEffect(() => {
    let cid = localStorage.getItem('lifelink_chat_id');
    if (!cid) {
      cid = 'chat_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('lifelink_chat_id', cid);
    }
    setConversationId(cid);
    
    // Attempt to load conversation history from local storage for seamless persistence
    const saved = localStorage.getItem('lifelink_chat_history');
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
      localStorage.setItem('lifelink_chat_history', JSON.stringify(messages));
    }
  }, [messages]);

  const scrollToBottom = () => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen, isTyping]);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, { sender: 'user', text: trimmed }]);
    setInputVal('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, text: trimmed }),
      });
      
      const data = await res.json();
      setMessages((prev) => [...prev, { sender: 'bot', text: data.reply, metadata: data }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'bot', text: 'Error connecting to LifeLink AI. Please try again later.' },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend(inputVal);
    }
  };

  const handleCreateEmergency = (parsedData: any) => {
    setIsOpen(false);
    // Use React Router state to pass data to Emergency page
    navigateTo('emergency', { autoFill: parsedData });
  };

  const handleQuickReply = (msg: string) => {
    handleSend(msg);
  };

  return (
    <>
      <button
        id="chatbot-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Ask LifeLink AI"
      >
        🤖
      </button>

      <div id="chat-window" className={isOpen ? 'open' : ''}>
        <div className="chat-hdr">
          <div className="chat-av">🤖</div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>LifeLink AI</div>
            <div style={{ fontSize: '11px', opacity: 0.8 }}>Powered by RAG + NLP</div>
          </div>
          <div className="chat-online" />
          <button
            onClick={() => setIsOpen(false)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '18px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div className="chat-msgs">
          {messages.map((m, index) => (
            <div
              key={index}
              className={`msg ${m.sender === 'user' ? 'msg-user' : 'msg-bot'}`}
            >
              {m.text}
              
              {/* Emergency Confirmation State */}
              {m.metadata && m.metadata.type === 'emergency_confirm' && (
                <div style={{ marginTop: '10px', background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#ef4444' }}>Detected Entities:</div>
                  <div>Blood Group: <b>{m.metadata.parsed_data?.blood_group || 'Unknown'}</b></div>
                  <div>Quantity: <b>{m.metadata.parsed_data?.quantity || 'Unknown'}</b></div>
                  <div>Hospital: <b>{m.metadata.parsed_data?.hospital || 'Unknown'}</b></div>
                  <div>Urgency: <b>{m.metadata.parsed_data?.urgency || 'Normal'}</b></div>
                  <div style={{ marginTop: '5px', fontSize: '10px', opacity: 0.7 }}>Intent Confidence: {(m.metadata.confidence * 100).toFixed(1)}%</div>
                  
                  <button 
                    onClick={() => handleCreateEmergency(m.metadata.parsed_data)}
                    style={{
                      marginTop: '8px',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      width: '100%'
                    }}>
                    Proceed to Create Request
                  </button>
                </div>
              )}

              {/* RAG Source Display */}
              {m.metadata && m.metadata.type === 'rag' && m.metadata.source && m.metadata.source.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--gr)', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '4px' }}>
                  <b>Sources:</b> {Array.from(new Set((m.metadata.source as any[]).map((s) => s.filename))).join(', ')}
                  <span style={{ float: 'right' }}>Conf: {(m.metadata.confidence * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          ))}
          
          {isTyping && (
            <div className="msg msg-bot" style={{ fontStyle: 'italic', opacity: 0.7 }}>
              Thinking...
            </div>
          )}
          <div ref={msgsEndRef} />
        </div>

        <div className="chat-qr">
          <button className="chat-qr-btn" onClick={() => handleQuickReply('Am I eligible to donate?')}>
            Eligibility?
          </button>
          <button className="chat-qr-btn" onClick={() => handleQuickReply('How does donation work?')}>
            Process
          </button>
          <button className="chat-qr-btn" onClick={() => handleQuickReply('I urgently need AB+ blood at CMC')}>
            Emergency
          </button>
        </div>

        <div className="chat-input-row">
          <input
            className="chat-in"
            placeholder="Ask anything..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isTyping}
          />
          <button className="chat-send" onClick={() => handleSend(inputVal)} disabled={isTyping}>
            Send
          </button>
        </div>
      </div>
    </>
  );
};
