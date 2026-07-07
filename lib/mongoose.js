const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MONGOOSE_PASSWORD = process.env.MONGOOSE_PASSWORD;
const MONGOOSE_DB_NAME = process.env.MONGOOSE_DB_NAME || 'song_shift';

async function connectToMongoDB() {
    try {
        await mongoose.connect(`mongodb+srv://alejodev97_db_user:${MONGOOSE_PASSWORD}@cluster0.ddqthal.mongodb.net/${MONGOOSE_DB_NAME}?appName=Cluster0`);
        logger.info(`You successfully connected to MongoDB database: ${MONGOOSE_DB_NAME}!`);
        return mongoose;
    } catch (err) {
        logger.error("Failed to connect to MongoDB!", err);
    }
}
// Call this only when your application terminates
async function disconnectFromMongoDB() {
    await mongoose.connection.close();
}

module.exports = {
    connectToMongoDB,
    disconnectFromMongoDB
};