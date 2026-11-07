// Its own module, apart from execute: the editor catches it, but only the session may apply commands.

/** A command the document refuses: its precondition failed or its result is not a valid document. */
export class DocumentCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentCommandError';
  }
}
