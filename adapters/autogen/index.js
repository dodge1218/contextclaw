class ContextClawAutoGenAdapter {
  constructor(config = {}) {
    this.stats = config.stats || false;
    this.debug = config.debug || false;
    this.policies = config.policies || {};
  }

  pruneMessages(messages) {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be an array');
    }

    const inputCount = messages.length;
    const prunedMessages = messages.map((msg) => ({
      ...msg,
      content: this._truncateContent(msg.content),
    }));

    if (this.debug) {
      console.log(`[ContextClaw-AutoGen] Pruned ${inputCount} messages`);
    }

    const stats = this.stats
      ? {
          inputCount,
          outputCount: prunedMessages.length,
          totalSaved: this._calculateSavings(messages, prunedMessages),
        }
      : null;

    return { messages: prunedMessages, ...(stats && { stats }) };
  }

  prepareContextForLLM(messages) {
    const { messages: lean } = this.pruneMessages(messages);
    return lean;
  }

  preprocessMessages(messages) {
    return this.pruneMessages(messages);
  }

  analyzeContext(messages) {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be an array');
    }

    const stats = {
      totalMessages: messages.length,
      totalChars: messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0),
      typeCounts: {},
    };

    messages.forEach((msg) => {
      const type = msg.role || 'unknown';
      stats.typeCounts[type] = (stats.typeCounts[type] || 0) + 1;
    });

    return stats;
  }

  _truncateContent(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }
    return content.length > 200 ? content.substring(0, 200) + '...' : content;
  }

  _calculateSavings(original, pruned) {
    const originalSize = original.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const prunedSize = pruned.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    return originalSize - prunedSize;
  }
}

export { ContextClawAutoGenAdapter };
