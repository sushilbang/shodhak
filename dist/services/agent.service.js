"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentService = exports.AgentService = void 0;
const agent_tools_1 = require("./agent-tools");
const agent_context_1 = require("./agent-context");
const context_compression_service_1 = require("./context-compression.service");
const logger_1 = require("../utils/logger");
const llm_client_factory_1 = require("../benchmark/utils/llm-client.factory");
const SYSTEM_PROMPT = `You are Shodhak, an intelligent research assistant specialized in academic literature research. You help users find, analyze, and synthesize academic papers.

## Your Capabilities
You have access to tools for:
1. **Searching papers**: Find papers by keywords or semantic similarity
2. **Analyzing papers**: Summarize individual papers, compare multiple papers, generate literature reviews
3. **Answering questions**: Answer research questions based on collected papers with citations
4. **Knowledge management**: Save and search user annotations

## Guidelines
- When a user asks about a research topic, FIRST ask 2-3 clarifying questions to understand:
  * What specific aspect of the topic they're interested in
  * What time period or recency they need (recent papers vs foundational work)
  * Their purpose (literature review, finding methods, understanding concepts)
- After getting clarification, search for relevant papers
- After finding papers, offer to summarize, compare, or analyze them
- Always cite papers by their index [0], [1], etc. when discussing their content
- Be proactive in suggesting useful analyses based on the collected papers
- When generating reviews or comparisons, use the available tools rather than generating content without them

## Important
- Check current papers in context using get_current_papers before assuming what's available
- When users reference papers by number, those are 0-based indices
- If no papers are in context and analysis is requested, search for papers first
`;
class AgentService {
    constructor() {
        this.MAX_ITERATIONS = 10;
        const { client, model, provider } = (0, llm_client_factory_1.createLLMClient)();
        this.client = client;
        this.MODEL = model;
        this.provider = provider;
        logger_1.logger.info('Agent service initialized', { provider, model });
    }
    async chat(userId, message, sessionId) {
        // Get or create context
        let context;
        if (sessionId) {
            const existing = await agent_context_1.contextManager.getContext(sessionId);
            if (existing && existing.userId === userId) {
                context = existing;
            }
            else {
                context = await agent_context_1.contextManager.createContext(userId);
            }
        }
        else {
            context = await agent_context_1.contextManager.createContext(userId);
        }
        // Add user message to history
        const userMessage = { role: 'user', content: message };
        await agent_context_1.contextManager.addMessage(context, userMessage);
        // Run compression check after adding message
        await context_compression_service_1.contextCompression.maybeCompress(context);
        // Build messages array for API call
        const messages = this.buildMessages(context);
        // Run the agent loop
        const response = await this.runAgentLoop(context, messages);
        // Persist metadata after loop completes
        await agent_context_1.contextManager.persistMetadata(context);
        return {
            ...response,
            sessionId: context.sessionId
        };
    }
    buildMessages(context) {
        // Use compressed context if summaries exist
        if (context.memoryState.summaries.length > 0) {
            return context_compression_service_1.contextCompression.buildCompressedContext(SYSTEM_PROMPT, context);
        }
        // Fallback to simple last-20 approach
        const contextSummary = agent_context_1.contextManager.buildContextSummary(context);
        const systemMessage = {
            role: 'system',
            content: SYSTEM_PROMPT + contextSummary
        };
        const recentHistory = context.conversationHistory.slice(-20);
        return [systemMessage, ...recentHistory];
    }
    async runAgentLoop(context, messages) {
        const toolsUsed = [];
        let iterations = 0;
        while (iterations < this.MAX_ITERATIONS) {
            iterations++;
            agent_context_1.contextManager.incrementIterations(context);
            logger_1.logger.info('Agent loop iteration', {
                iteration: iterations,
                sessionId: context.sessionId
            });
            try {
                // Call LLM with tools
                const response = await this.client.chat.completions.create({
                    model: this.MODEL,
                    messages: messages,
                    tools: agent_tools_1.AGENT_TOOLS,
                    tool_choice: 'auto',
                    max_tokens: 4096,
                });
                const assistantMessage = response.choices[0].message;
                // Check for tool calls
                const toolCalls = assistantMessage.tool_calls;
                if (toolCalls && toolCalls.length > 0) {
                    // Add assistant message with tool calls to history
                    const toolCallMessage = {
                        role: 'assistant',
                        content: assistantMessage.content,
                        tool_calls: toolCalls.map(tc => ({
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.function.name,
                                arguments: tc.function.arguments
                            }
                        }))
                    };
                    await agent_context_1.contextManager.addMessage(context, toolCallMessage);
                    messages.push(toolCallMessage);
                    // Execute each tool call
                    for (const toolCall of toolCalls) {
                        const toolName = toolCall.function.name;
                        let args;
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        }
                        catch (e) {
                            args = {};
                            logger_1.logger.warn('Failed to parse tool arguments', {
                                toolName,
                                arguments: toolCall.function.arguments
                            });
                        }
                        toolsUsed.push(toolName);
                        logger_1.logger.info('Executing tool call', {
                            toolName,
                            args,
                            sessionId: context.sessionId
                        });
                        const result = await agent_tools_1.toolExecutor.execute(toolName, args, context);
                        // Add tool result to messages
                        const toolResultMessage = {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify(result)
                        };
                        await agent_context_1.contextManager.addMessage(context, toolResultMessage);
                        messages.push(toolResultMessage);
                    }
                    // Continue loop to get next response
                    continue;
                }
                // No tool calls from API - check if model output tool call as text
                const content = assistantMessage.content || '';
                const textToolCall = this.parseTextToolCall(content);
                if (textToolCall) {
                    // Model output tool call as JSON text - execute it
                    logger_1.logger.info('Detected text-based tool call', {
                        toolName: textToolCall.name,
                        sessionId: context.sessionId
                    });
                    toolsUsed.push(textToolCall.name);
                    const result = await agent_tools_1.toolExecutor.execute(textToolCall.name, textToolCall.parameters, context);
                    // Add assistant message and tool result
                    await agent_context_1.contextManager.addMessage(context, { role: 'assistant', content });
                    messages.push({ role: 'assistant', content });
                    // Add result as user message (since we don't have proper tool_call_id)
                    const resultMessage = `Tool "${textToolCall.name}" result: ${JSON.stringify(result.data || result.error, null, 2)}`;
                    await agent_context_1.contextManager.addMessage(context, { role: 'user', content: resultMessage });
                    messages.push({ role: 'user', content: resultMessage });
                    // Continue loop
                    continue;
                }
                // No tool calls - we have a final response
                const finalContent = content;
                // Add final assistant message to history
                const finalMessage = {
                    role: 'assistant',
                    content: finalContent
                };
                await agent_context_1.contextManager.addMessage(context, finalMessage);
                // Run compression after final response
                await context_compression_service_1.contextCompression.maybeCompress(context);
                return {
                    message: finalContent,
                    papers: context.papers,
                    toolsUsed: [...new Set(toolsUsed)],
                    iterationCount: iterations,
                    done: true
                };
            }
            catch (error) {
                const errorMessage = error?.message || error?.error?.message || String(error);
                logger_1.logger.error('Agent loop error', {
                    error: errorMessage,
                    errorType: error?.constructor?.name,
                    iteration: iterations,
                    sessionId: context.sessionId
                });
                // If model doesn't support tools, fall back to simple completion
                if (this.isToolNotSupportedError(error)) {
                    return this.fallbackNoTools(context, messages[messages.length - 1].content || '');
                }
                // Return error message to user instead of throwing
                return {
                    message: `Error: ${errorMessage}. Please check your LLM provider configuration and API keys.`,
                    papers: context.papers,
                    toolsUsed: [...new Set(toolsUsed)],
                    iterationCount: iterations,
                    done: false
                };
            }
        }
        // Max iterations reached
        logger_1.logger.warn('Agent reached max iterations', {
            sessionId: context.sessionId,
            iterations
        });
        return {
            message: 'I apologize, but I was unable to complete the task within the allowed number of steps. Could you please simplify your request or break it into smaller parts?',
            papers: context.papers,
            toolsUsed: [...new Set(toolsUsed)],
            iterationCount: iterations,
            done: false
        };
    }
    isToolNotSupportedError(error) {
        const errorStr = String(error?.message || error);
        return (errorStr.includes('tool') ||
            errorStr.includes('function') ||
            errorStr.includes('not supported'));
    }
    // Fallback for models without tool support
    async fallbackNoTools(context, userMessage) {
        logger_1.logger.info('Using fallback mode without tools', { sessionId: context.sessionId });
        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            messages: [
                {
                    role: 'system',
                    content: `You are Shodhak, a research assistant. Tool calling is not available with this model. Provide helpful guidance about research. Current papers in context: ${context.papers.length}`
                },
                { role: 'user', content: userMessage }
            ],
            max_tokens: 2048,
        });
        const content = response.choices[0]?.message?.content || 'I apologize, I encountered an issue processing your request.';
        await agent_context_1.contextManager.addMessage(context, { role: 'assistant', content });
        return {
            message: content,
            papers: context.papers,
            toolsUsed: [],
            iterationCount: 1,
            done: true
        };
    }
    // Parse tool call from text (fallback for models that output JSON as text)
    parseTextToolCall(content) {
        try {
            // Try to find JSON-like structure in the content
            const jsonMatch = content.match(/\{[\s\S]*"name"[\s\S]*(?:"parameters"|"arguments")[\s\S]*\}/);
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                // Fix common malformed JSON issues from LLMs
                jsonStr = jsonStr.replace(/\\+"/g, '"');
                jsonStr = jsonStr.replace(/"(\w+)\\+":/g, '"$1":');
                jsonStr = jsonStr.replace(/"parameters"\s*=/g, '"parameters":');
                jsonStr = jsonStr.replace(/"arguments"\s*=/g, '"arguments":');
                jsonStr = jsonStr.replace(/"parameters"\s*\{/g, '"parameters": {');
                jsonStr = jsonStr.replace(/"arguments"\s*\{/g, '"arguments": {');
                jsonStr = jsonStr.replace(/"(\w+)"\s*=/g, '"$1":');
                jsonStr = jsonStr.replace(/:+/g, ':');
                const parsed = JSON.parse(jsonStr);
                if (parsed.name && typeof parsed.name === 'string') {
                    return {
                        name: parsed.name,
                        parameters: parsed.parameters || parsed.arguments || {}
                    };
                }
            }
        }
        catch (e) {
            logger_1.logger.debug('Failed to parse text tool call', { content, error: String(e) });
        }
        return null;
    }
    // Get session info
    async getSession(sessionId, userId) {
        const context = await agent_context_1.contextManager.getContext(sessionId);
        if (context && context.userId === userId) {
            return context;
        }
        return null;
    }
    // End session
    async endSession(sessionId) {
        return agent_context_1.contextManager.deleteContext(sessionId);
    }
}
exports.AgentService = AgentService;
exports.agentService = new AgentService();
