import React, { useRef, useEffect, useState, Suspense } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useUiStore } from '../store/useUiStore';
import { InputArea } from './InputArea';
import { ErrorBoundary } from './ErrorBoundary';
import { streamGeminiResponse, generateContent } from '../services/geminiService';
import { convertMessagesToHistory } from '../utils/messageUtils';
import { ChatMessage, Attachment, Part } from '../types';
import { Sparkles } from 'lucide-react';
import { lazyWithRetry } from '../utils/lazyLoadUtils';

// Lazy load components
const ThinkingIndicator = lazyWithRetry(() => import('./ThinkingIndicator').then(m => ({ default: m.ThinkingIndicator })));
const MessageBubble = lazyWithRetry(() => import('./MessageBubble').then(m => ({ default: m.MessageBubble })));

export const ChatInterface: React.FC = () => {
  const {
    apiKey,
    messages,
    settings,
    addMessage,
    updateLastMessage,
    addImageToHistory,
    isLoading,
    setLoading,
    deleteMessage,
    sliceMessages,
    fetchBalance
  } = useAppStore();

  const { batchMode, batchCount, setBatchMode, addToast, setShowApiKeyModal } = useUiStore();

  const [showArcade, setShowArcade] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isLoading) {
        setShowArcade(true);
        setIsExiting(false);
    }
  }, [isLoading]);

  const handleCloseArcade = () => {
    setIsExiting(true);
    setTimeout(() => {
        setShowArcade(false);
        setIsExiting(false);
    }, 200); // Match animation duration
  };

  const handleToggleArcade = () => {
      if (showArcade && !isExiting) {
          handleCloseArcade();
      } else if (!showArcade) {
          setShowArcade(true);
      }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, showArcade]);

  const handleSend = async (text: string, attachments: Attachment[]) => {
    // 检查 API Key
    if (!apiKey) {
      setShowApiKeyModal(true);
      addToast('请先输入 API Key', 'error');
      return;
    }

    // 批量生成处理
    if (batchMode !== 'off') {
      let tasks: Array<{ text: string; attachments: Attachment[] }> = [];

      if (batchMode === 'normal') {
        // 普通批量：重复 N 次
        for (let i = 0; i < batchCount; i++) {
          tasks.push({ text, attachments });
        }
      } else if (batchMode === 'multi-image') {
        // 多图单词：每张图片单独生成
        if (attachments.length === 0) {
          addToast('请至少上传一张图片以使用多图单词模式', 'error');
          return;
        }
        tasks = attachments.map(att => ({
          text,
          attachments: [att]
        }));
      } else if (batchMode === 'image-multi-prompt') {
        // 图片对多词：每张图片配对一个提示词
        if (attachments.length === 0) {
          addToast('请至少上传一张图片以使用图片对多词模式', 'error');
          return;
        }
        if (!text.trim()) {
          addToast('请输入提示词（多个提示词用 --- 分隔）', 'error');
          return;
        }

        // 分割提示词（使用 --- 作为分隔符）
        const prompts = text.split(/---+/).map(p => p.trim()).filter(p => p.length > 0);

        if (prompts.length === 0) {
          addToast('请输入有效的提示词', 'error');
          return;
        }

        // 每张图片配对一个提示词（如果提示词不够，循环使用）
        tasks = attachments.map((att, index) => ({
          text: prompts[index % prompts.length],
          attachments: [att]
        }));
      }

      // 执行批量任务
      setBatchProgress({ current: 0, total: tasks.length });
      addToast(`开始批量生成 ${tasks.length} 张图片`, 'info');

      for (let i = 0; i < tasks.length; i++) {
        setBatchProgress({ current: i + 1, total: tasks.length });
        try {
          await executeSingleGeneration(tasks[i].text, tasks[i].attachments);
          // 每个任务之间稍作延迟，避免请求过快
          if (i < tasks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`批量任务 ${i + 1} 失败:`, error);
          // 继续执行下一个任务
        }
      }

      setBatchProgress({ current: 0, total: 0 });
      setBatchMode('off'); // 完成后自动关闭批量模式
      addToast(`批量生成完成！共生成 ${tasks.length} 张图片`, 'success');
      return;
    }

    // 单次生成
    await executeSingleGeneration(text, attachments);
  };

  const executeSingleGeneration = async (text: string, attachments: Attachment[]) => {
    // Capture the current messages state *before* adding the new user message.
    // This allows us to generate history up to this point.
    const currentMessages = useAppStore.getState().messages;
    const history = convertMessagesToHistory(currentMessages);

    setLoading(true);
    const msgId = Date.now().toString();

    // Construct User UI Message
    const userParts: Part[] = [];
    attachments.forEach(att => {
        userParts.push({
            inlineData: {
                mimeType: att.mimeType,
                data: att.base64Data
            }
        });
    });
    if (text) userParts.push({ text });

    const userMessage: ChatMessage = {
      id: msgId,
      role: 'user',
      parts: userParts,
      timestamp: Date.now()
    };
    
    // Add User Message
    addMessage(userMessage);

    // Prepare Model Placeholder
    const modelMessageId = (Date.now() + 1).toString();
    const modelMessage: ChatMessage = {
      id: modelMessageId,
      role: 'model',
      parts: [], // Start empty
      timestamp: Date.now()
    };
    
    // Add Placeholder Model Message to Store
    addMessage(modelMessage);

    try {
      // Prepare images for service
      const imagesPayload = attachments.map(a => ({
          base64Data: a.base64Data,
          mimeType: a.mimeType
      }));

      abortControllerRef.current = new AbortController();

      const startTime = Date.now();
      let thinkingDuration = 0;
      let isThinking = false;

      if (settings.streamResponse) {
          const stream = streamGeminiResponse(
            apiKey,
            history, 
            text,
            imagesPayload,
            settings,
            abortControllerRef.current.signal
          );

          for await (const chunk of stream) {
              // Check if currently generating thought
              const lastPart = chunk.modelParts[chunk.modelParts.length - 1];
              if (lastPart && lastPart.thought) {
                  isThinking = true;
                  thinkingDuration = (Date.now() - startTime) / 1000;
              } else if (isThinking && lastPart && !lastPart.thought) {
                // Just finished thinking
                isThinking = false;
              }

              updateLastMessage(chunk.modelParts, false, isThinking ? thinkingDuration : undefined);
          }
          
          // Final update to ensure duration is set if ended while thinking (unlikely but possible)
          // or to set the final duration if the whole response was a thought
          if (isThinking) {
              thinkingDuration = (Date.now() - startTime) / 1000;
              updateLastMessage(useAppStore.getState().messages.slice(-1)[0].parts, false, thinkingDuration);
          }
      } else {
          const result = await generateContent(
            apiKey,
            history, 
            text,
            imagesPayload,
            settings,
            abortControllerRef.current.signal
          );

          // Calculate thinking duration for non-streaming response
          let totalDuration = (Date.now() - startTime) / 1000;
          // In non-streaming, we can't easily separate thinking time from generation time precisely
          // unless the model metadata provides it (which it currently doesn't in a standardized way exposed here).
          // But we can check if there are thinking parts and attribute some time or just show total time?
          // The UI expects thinkingDuration to show beside the "Thinking Process" block.
          // If we have thought parts, we can pass the total duration as a fallback, or 0 if we don't want to guess.
          // However, existing UI logic in MessageBubble uses `thinkingDuration` prop on the message.
          
          const hasThought = result.modelParts.some(p => p.thought);
          updateLastMessage(result.modelParts, false, hasThought ? totalDuration : undefined);
      }

      // 收集生成的图片到历史记录
      const finalMessage = useAppStore.getState().messages.slice(-1)[0];
      if (finalMessage && finalMessage.role === 'model') {
        const imageParts = finalMessage.parts.filter(p => p.inlineData && !p.thought);
        imageParts.forEach(part => {
          if (part.inlineData) {
            addImageToHistory({
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              mimeType: part.inlineData.mimeType,
              base64Data: part.inlineData.data,
              prompt: text || '图片生成',
              timestamp: Date.now(),
              modelName: settings.modelName,
            });
          }
        });
      }

    } catch (error: any) {
      if (error.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
        console.log("用户已停止生成");
        return;
      }
      console.error("生成失败", error);
      
      let errorText = "生成失败。请检查您的网络和 API Key。";
      if (error.message) {
          errorText = `Error: ${error.message}`;
      }

      // Update the placeholder message with error text and flag
      updateLastMessage([{ text: errorText }], true);

    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      // 每次生成结束后静默刷新余额
      fetchBalance();
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleDelete = (id: string) => {
    deleteMessage(id);
  };

  const handleRegenerate = async (id: string) => {
    if (isLoading) return;

    const index = messages.findIndex(m => m.id === id);
    if (index === -1) return;
    
    const message = messages[index];
    let targetUserMessage: ChatMessage | undefined;
    let sliceIndex = -1;

    if (message.role === 'user') {
        targetUserMessage = message;
        sliceIndex = index - 1;
    } else if (message.role === 'model') {
        // Find preceding user message
        if (index > 0 && messages[index-1].role === 'user') {
            targetUserMessage = messages[index-1];
            sliceIndex = index - 2;
        }
    }
    
    if (!targetUserMessage) return;

    // Extract content
    const textPart = targetUserMessage.parts.find(p => p.text);
    const text = textPart ? textPart.text : '';
    const imageParts = targetUserMessage.parts.filter(p => p.inlineData);
    
    const attachments: Attachment[] = imageParts.map(p => ({
        file: new File([], "placeholder"), // Dummy file object
        preview: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}`,
        base64Data: p.inlineData!.data || '',
        mimeType: p.inlineData!.mimeType || ''
    }));

    // Slice history (delete target and future)
    sliceMessages(sliceIndex);

    // Resend
    handleSend(text || '', attachments);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 transition-colors duration-200">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 space-y-8 scroll-smooth overscroll-y-contain"
      >
        {/* Batch Progress Indicator */}
        {batchProgress.total > 0 && (
          <div className="sticky top-0 z-10 mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                批量生成进度
              </span>
              <span className="text-sm text-amber-700 dark:text-amber-300">
                {batchProgress.current} / {batchProgress.total}
              </span>
            </div>
            <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center opacity-40 select-none">
            <div className="mb-6 rounded-3xl bg-gray-50 dark:bg-gray-900 p-8 shadow-2xl ring-1 ring-gray-200 dark:ring-gray-800 transition-colors duration-200">
               <Sparkles className="h-16 w-16 text-amber-500 mb-4 mx-auto animate-pulse-fast" />
               <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Nano Banana Pro</h3>
               <p className="max-w-xs text-sm text-gray-500 dark:text-gray-400">
                 开始输入以创建图像，通过对话编辑它们，或询问复杂的问题。
               </p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ErrorBoundary key={msg.id}>
            <Suspense fallback={<div className="h-12 w-full animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg mb-4"></div>}>
              <MessageBubble 
                message={msg} 
                isLast={index === messages.length - 1}
                isGenerating={isLoading}
                onDelete={handleDelete}
                onRegenerate={handleRegenerate}
              />
            </Suspense>
          </ErrorBoundary>
        ))}

        {showArcade && (
            <React.Suspense fallback={
                <div className="flex w-full justify-center py-6 fade-in-up">
                    <div className="w-full max-w-xl h-96 rounded-xl bg-gray-100 dark:bg-gray-900/50 animate-pulse border border-gray-200 dark:border-gray-800"></div>
                </div>
            }>
                <ThinkingIndicator 
                    isThinking={isLoading} 
                    onClose={handleCloseArcade}
                    isExiting={isExiting}
                />
            </React.Suspense>
        )}
      </div>

      <InputArea 
        onSend={handleSend} 
        onStop={handleStop} 
        disabled={isLoading}
        onOpenArcade={handleToggleArcade}
        isArcadeOpen={showArcade}
      />
    </div>
  );
};
