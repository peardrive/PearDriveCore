import fs from "fs";

/**
 * Logging system for Sister that allows for monitoring of verbose debugging
 * information and recording of log data to a given file
 *
 * @param {Object} [opts] - Configuration options
 * @param {boolean} [logToFile] - Log to file flag
 * @param {boolean} [logFilePath] - Log file path
 * @param {boolean} [logToConsole] - Log to console flag
 */
class Logger {
  constructor({ logToFile = false, logToConsole = false, logFilePath }) {
    this.logToFile = logToFile || false;
    this.logToConsole = logToConsole || false;
    this.logFilePath = logFilePath || undefined;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * DEBUG - intended for logging detailed information about Sister and for
   * debugging.
   */
  debug(...message) {
    this.#log("DEBUG", ...message);
  }

  /** INFO - Provides information on the Sister's normal operation. */
  info(...message) {
    this.#log("INFO", ...message);
  }

  /** WARN - Notifies of potential issues that may lead to errors. */
  warn(...message) {
    this.#log("WARN", ...message);
  }

  /** ERROR - Indicates an error that may cause the Sister to fail. */
  error(...message) {
    this.#log("ERROR", ...message);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /** Log function */
  #log(level, ...message) {
    // Construct string
    const payloadString = this.#getFormattedMessage(...message);
    const date = this.#getFormattedDate();
    const logMessage = `${date} [${level}] ${payloadString}`;

    // Write
    this.#logToFile(logMessage);
    this.#logToConsole(logMessage);
  }

  /** Log message to file */
  #logToFile(message) {
    if (this.logToFile) {
      if (!this.logFilePath) {
        throw new Error("No log file path provided");
      }
      fs.appendFileSync(this.logFilePath, message);
    }
  }

  /** Log message to console */
  #logToConsole(message) {
    if (this.logToConsole) console.log(message);
  }

  /** Get timestamp for logging */
  #getFormattedDate() {
    const now = new Date();
    return now.toISOString();
  }

  /** Format log message to string */
  #getFormattedMessage(...message) {
    return (
      message
        .map((arg) => {
          return String(arg);
        })
        .join(" ") + "\n"
    );
  }
}

export default Logger;
