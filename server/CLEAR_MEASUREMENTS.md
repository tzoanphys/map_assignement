# Clear all measurements from the database

To remove all saved measurements (e.g. for a fresh start), use the MongoDB shell.

1. Open a terminal and run:
   ```bash
   mongosh
   ```

2. Switch to the app database and delete all documents in the `measurements` collection:
   ```javascript
   use measurements_db
   db.measurements.deleteMany({})
   ```

3. You should see something like: `{ acknowledged: true, deletedCount: 17 }` (the number is how many were removed).

4. Type `exit` to leave mongosh.

After that, the database is empty. Reload the map app and you will see "No measurements yet." New drawings will be stored again.
