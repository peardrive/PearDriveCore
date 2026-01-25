/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const fs = require("fs").promises;
const utils = require("./utils.js");

/**
 * Utility class for cleaning up corestore namespaces to prevent storage bloat.
 * Simple API: call performCleanup() for broad cleanup, or performCleanup(filePath) for targeted cleanup.
 */
class NamespaceCleanup {
  constructor(store, watchPath, log, uploads, downloads) {
    this._store = store;
    this._watchPath = watchPath;
    this._log = log;
    this._uploads = uploads; // Reference to IndexManager._uploads Map
    this._downloads = downloads; // Reference to IndexManager._downloads Map
  }

  /**
   * Simple cleanup API that handles both targeted and broad cleanup.
   * 
   * @param {string} [filePath] - Optional file path for targeted cleanup. If not provided, performs broad cleanup.
   * @param {Object} options - Cleanup options
   * @param {boolean} options.cleanupUploads - Clean upload namespaces (default: true)
   * @param {boolean} options.cleanupDownloads - Clean download namespaces (default: true)
   * @param {boolean} options.dryRun - Only log what would be cleaned (default: false)
   * @param {number} options.maxAgeMs - Max age before cleanup for broad cleanup (default: 1 hour)
   * @returns {Promise<{uploadsCleaned: number, downloadsCleaned: number, bytesFreed: number}>}
   */
  async performCleanup(filePath, options = {}) {
    if (filePath) {
      // Targeted cleanup for specific file
      return await this.#cleanupForFile(filePath, options);
    } else {
      // Broad cleanup - scan for orphaned namespaces
      return await this.#performBroadCleanup(options);
    }
  }

  /**
   * Targeted cleanup for specific file (private implementation)
   * @private
   */
  async #cleanupForFile(filePath, options = {}) {
    const { cleanupUploads = true, cleanupDownloads = true, dryRun = false } = options;
    
    this._log.info(`${dryRun ? '[DRY RUN] ' : ''}Cleaning up namespaces for file: ${filePath}`);
    
    const results = { uploadsCleaned: 0, downloadsCleaned: 0, bytesFreed: 0 };
    
    try {
      if (cleanupUploads) {
        const uploadNamespace = this.#buildNamespacePath(filePath, "upload:blobs");
        const uploadBytes = await this.#cleanupSingleNamespace(uploadNamespace, dryRun);
        if (uploadBytes > 0) {
          results.uploadsCleaned = 1;
          results.bytesFreed += uploadBytes;
        }
      }

      if (cleanupDownloads) {
        const downloadNamespace = this.#buildNamespacePath(filePath, "download:blobs");
        const downloadBytes = await this.#cleanupSingleNamespace(downloadNamespace, dryRun);
        if (downloadBytes > 0) {
          results.downloadsCleaned = 1;
          results.bytesFreed += downloadBytes;
        }
      }

      this._log.debug(`File cleanup completed for ${filePath}:`, results);
    } catch (err) {
      this._log.error(`Failed to cleanup namespaces for file ${filePath}:`, err);
      throw err;
    }

    return results;
  }

  /**
   * Broad cleanup implementation (private) - automatically gathers active files
   * @private
   */
  async #performBroadCleanup(options = {}) {
    const { 
      maxAgeMs = 60 * 60 * 1000, 
      dryRun = false
    } = options;
    
    this._log.info(`${dryRun ? '[DRY RUN] ' : ''}Starting broad namespace cleanup (maxAge: ${maxAgeMs}ms)`);
    
    // Automatically gather currently active files from Maps
    const activeUploads = Array.from(this._uploads.keys()).map(dPath => 
      utils.formatFromDrivePath(dPath)
    );
    const activeDownloads = Array.from(this._downloads.keys()).map(dPath => 
      utils.formatFromDrivePath(dPath)
    );
    
    this._log.debug(`Found ${activeUploads.length} active uploads, ${activeDownloads.length} active downloads`);
    
    const results = { uploadsCleaned: 0, downloadsCleaned: 0, bytesFreed: 0 };
    
    try {
      // Clean upload namespaces (primary source of bloat)
      const uploadResults = await this.#scanAndCleanupNamespaces("upload:blobs", {
        maxAgeMs,
        dryRun,
        activeFiles: activeUploads
      });
      results.uploadsCleaned = uploadResults.cleaned;
      results.bytesFreed += uploadResults.bytesFreed;

      // Clean download namespaces
      const downloadResults = await this.#scanAndCleanupNamespaces("download:blobs", {
        maxAgeMs,
        dryRun,
        activeFiles: activeDownloads
      });
      results.downloadsCleaned = downloadResults.cleaned;
      results.bytesFreed += downloadResults.bytesFreed;

      this._log.info(`Broad cleanup completed:`, results);
    } catch (err) {
      this._log.error('Broad cleanup failed:', err);
      throw err;
    }

    return results;
  }

  /**
   * Build namespace path from file path and prefix
   * @private
   */
  #buildNamespacePath(filePath, prefix) {
    const key = utils.formatToStr(filePath);
    return `${prefix}:${key}`;
  }

  /**
   * Scan and cleanup namespaces of a specific type
   * @private
   */
  async #scanAndCleanupNamespaces(type, options) {
    const { maxAgeMs, dryRun, activeFiles } = options;
    const prefix = `${type}:`;
    
    let cleaned = 0;
    let bytesFreed = 0;
    const now = Date.now();

    try {
      // Discover namespaces of this type
      const namespaces = await this.#discoverNamespaces(prefix);
      
      for (const namespacePath of namespaces) {
        try {
          const filePath = this.#extractFilePathFromNamespace(namespacePath, prefix);
          
          // Skip if file is currently active
          if (activeFiles.some(active => utils.asDrivePath(active) === utils.asDrivePath(filePath))) {
            this._log.debug(`Skipping active ${type}: ${filePath}`);
            continue;
          }
          
          // Check if this namespace should be cleaned up
          const shouldCleanup = await this.#shouldCleanupNamespace(namespacePath, filePath, type, maxAgeMs, now);
          
          if (shouldCleanup) {
            const namespaceBytesFreed = await this.#cleanupSingleNamespace(namespacePath, dryRun);
            cleaned++;
            bytesFreed += namespaceBytesFreed;
            
            this._log.info(`${dryRun ? '[DRY RUN] Would cleanup' : 'Cleaned up'} ${type} namespace: ${filePath}`);
          }
          
        } catch (err) {
          this._log.error(`Error processing ${type} namespace ${namespacePath}:`, err);
        }
      }
      
    } catch (err) {
      this._log.error(`Failed to scan ${type} namespaces:`, err);
      throw err;
    }

    return { cleaned, bytesFreed };
  }

  /**
   * Discover all namespaces matching a prefix
   * @private
   */
  async #discoverNamespaces(prefix) {
    const namespaces = [];
    
    try {
      // Use corestore's internal structure to find namespace keys
      const db = this._store._db;
      const view = this._store._view;
      
      if (!db || !view) {
        this._log.warn('Unable to access corestore internals for namespace discovery');
        return [];
      }
      
      // Import the streams utility from hypercore-storage
      const streams = require('hypercore-storage/lib/streams');
      const stream = streams.createAliasStream(db, view, prefix);
      
      for await (const entry of stream) {
        if (entry.alias && entry.alias.startsWith(prefix)) {
          namespaces.push(entry.alias);
        }
      }
      
    } catch (err) {
      this._log.error('Error discovering namespaces:', err);
      // Return empty array rather than throwing - this allows cleanup to continue
      // with known active namespaces even if discovery fails
    }
    
    this._log.debug(`Discovered ${namespaces.length} namespaces with prefix ${prefix}`);
    return namespaces;
  }

  /**
   * Extract file path from namespace
   * @private
   */
  #extractFilePathFromNamespace(namespacePath, prefix) {
    return namespacePath.slice(prefix.length);
  }

  /**
   * Determine if a namespace should be cleaned up
   * @private
   */
  async #shouldCleanupNamespace(namespacePath, filePath, type, maxAgeMs, now) {
    // Check file system state to determine cleanup eligibility
    try {
      const absPath = utils.createAbsPath(filePath, this._watchPath);
      const stats = await fs.stat(absPath);
      
      if (type === "upload:blobs") {
        // For uploads: cleanup if file is old enough
        const ageMs = now - stats.mtime.getTime();
        return ageMs > maxAgeMs;
      } else if (type === "download:blobs") {
        // For downloads: cleanup if file exists (download completed)
        return true;
      }
    } catch {
      // File doesn't exist
      if (type === "upload:blobs") {
        // Upload file gone - definitely cleanup
        return true;
      } else if (type === "download:blobs") {
        // Download never completed - cleanup orphaned namespace
        return true;
      }
    }

    return false;
  }

  /**
   * Clean up a single namespace
   * @private
   */
  async #cleanupSingleNamespace(namespacePath, dryRun) {
    if (dryRun) {
      // Estimate bytes that would be freed
      return 1024 * 1024; // 1MB estimate per namespace
    }
    
    try {
      // Create namespace reference and close it
      const namespace = this._store.namespace(namespacePath);
      await namespace.close();
      
      this._log.debug(`Successfully cleaned up namespace: ${namespacePath}`);
      return 1024 * 1024; // Return estimated bytes freed
    } catch (err) {
      this._log.error(`Failed to cleanup namespace ${namespacePath}:`, err);
      // Return 0 bytes freed on failure but don't throw - continue cleanup
      return 0;
    }
  }
}

module.exports = NamespaceCleanup;