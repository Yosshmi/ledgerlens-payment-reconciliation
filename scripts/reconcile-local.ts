import {connect} from '../server/src/models.js';
import {reconcile} from '../server/src/workers/reconcile.js';
import mongoose from 'mongoose';
await connect();await reconcile('ORG_NOVAPAY');await mongoose.disconnect();console.log('Local demo projections refreshed.');
