declare module "ready-resource" {
  import { EventEmitter } from "events";

  class ReadyResource extends EventEmitter {
    private opening: Promise<void> | null;
    private closing: Promise<void> | null;
    private opened: boolean;
    private closed: boolean;

    constructor();

    /**
     * Returns a promise that resolves when the resource is ready
     */
    ready(): Promise<void>;

    /**
     * Opens the resource
     */
    open(): Promise<void>;

    /**
     * Closes the resource
     */
    close(): Promise<void>;

    /**
     * Protected method to be overridden by subclasses for custom open logic
     */
    protected _open(): Promise<void>;

    /**
     * Protected method to be overridden by subclasses for custom close logic
     */
    protected _close(): Promise<void>;
  }

  export = ReadyResource;
}
