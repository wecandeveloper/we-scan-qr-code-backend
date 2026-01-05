# MongoDB Index Cleanup Instructions

## Index to Delete

**Collection:** `counters`  
**Index Name:** `restaurantId_1`

## Why It's Safe to Delete

1. **Our Counter Model No Longer Uses This Collection**
   - Our `Counter` model now uses the `orderCounters` collection (configured in `counter.model.js`)
   - The `restaurantId_1` index in `counters` was created by the old Counter model
   - This index is no longer needed

2. **mongoose-sequence Plugin Doesn't Need It**
   - The `mongoose-sequence` plugin uses the `counters` collection
   - It stores counters with `_id: 'payments'` (no `restaurantId` field)
   - The `restaurantId_1` index conflicts with this usage

3. **No Data Loss**
   - **Deleting an index does NOT delete any data**
   - It only removes the unique constraint
   - All documents in the collection remain intact

## How to Delete in MongoDB Atlas

1. Go to MongoDB Atlas → Your Cluster → **Browse Collections**
2. Find the `counters` collection
3. Click on the **Indexes** tab
4. Look for an index named `restaurantId_1`
5. Click the **Drop** button next to it
6. Confirm the deletion

## What to Keep

**DO NOT DELETE:**
- `_id_` index (default MongoDB index - required)
- Any other indexes you're not sure about

**ONLY DELETE:**
- `restaurantId_1` index from the `counters` collection

## Verification

After deleting, you should see:
- `counters` collection still exists
- Only `_id_` index remains (or other indexes you didn't delete)
- Payment creation should work without errors

## Impact on Other Collections

**No impact on:**
- `orderCounters` collection (our Counter model)
- `payments` collection
- `orders` collection
- Any other collections

The `restaurantId_1` index only exists in the `counters` collection and is not used by any other part of the application.

