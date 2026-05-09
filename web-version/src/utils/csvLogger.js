// CSV Logger - Client-side logging for CSV download only
// Server persistence is handled by GameTracker

class CSVLogger {
  constructor(config) {
    this.subjectId = config?.id || '';
    this.sessionId = config?.sessionGameId || this.subjectId;
    this.logs = [];
    this.header = [
      'date', 'id', 'sessionGameId', 'condition', 'phase', 'type', 'time',
      'unit', 'end_position', 'all_positions',
      'gallery_shape_number', 'gallery', 'gallery_normalized'
    ];
  }

  write(entry) {
    // Only store in memory for CSV download
    this.logs.push(entry);
  }




  clear() {
    this.logs = [];
  }
}

export default CSVLogger;
