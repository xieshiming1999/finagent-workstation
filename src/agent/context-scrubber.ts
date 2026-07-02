/**
 * Streaming context scrubber.
 * Strips <memory-context> fence tags from streaming deltas so internal
 * memory injection never leaks into the visible UI stream, even when
 * tags span chunk boundaries.
 *
 * Reference: hermes-agent/agent/memory_manager.py StreamingContextScrubber
 */

export class StreamingContextScrubber {
  private buffer = ''
  private inFence = false
  private openTag = '<memory-context>'
  private closeTag = '</memory-context>'

  /**
   * Process a text delta chunk. Returns the cleaned text to show to the user.
   * May buffer partial tags across calls.
   */
  scrub(chunk: string): string {
    this.buffer += chunk
    let output = ''

    while (this.buffer.length > 0) {
      if (this.inFence) {
        const closeIdx = this.buffer.indexOf(this.closeTag)
        if (closeIdx === -1) {
          // Still inside fence, consume all
          this.buffer = ''
          break
        }
        // Found close tag — skip everything up to and including it
        this.buffer = this.buffer.slice(closeIdx + this.closeTag.length)
        this.inFence = false
        continue
      }

      const openIdx = this.buffer.indexOf(this.openTag)
      if (openIdx === -1) {
        // No open tag — check if buffer might contain partial tag
        const partialMatch = this.findPartialTag(this.buffer, this.openTag)
        if (partialMatch >= 0) {
          output += this.buffer.slice(0, partialMatch)
          this.buffer = this.buffer.slice(partialMatch)
          break // Wait for more data
        }
        output += this.buffer
        this.buffer = ''
        break
      }

      // Found open tag — output text before it, enter fence
      output += this.buffer.slice(0, openIdx)
      this.buffer = this.buffer.slice(openIdx + this.openTag.length)
      this.inFence = true
    }

    return output
  }

  /** Check if the end of text could be a partial match of tag */
  private findPartialTag(text: string, tag: string): number {
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) {
        return text.length - len
      }
    }
    return -1
  }

  reset(): void {
    this.buffer = ''
    this.inFence = false
  }
}
