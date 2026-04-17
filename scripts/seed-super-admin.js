const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("../app/models/user.model");

const REQUIRED_ENV_VARS = [
    "SUPER_ADMIN_FIRST_NAME",
    "SUPER_ADMIN_LAST_NAME",
    "SUPER_ADMIN_EMAIL",
    "SUPER_ADMIN_PASSWORD",
    "SUPER_ADMIN_PHONE",
    "SUPER_ADMIN_COUNTRY_CODE",
];

function getMongoUri() {
    return (
        process.env.MONGODB_CLOUD_URI ||
        process.env.MONGODB_URI ||
        process.env.DB_URI
    );
}

function getMissingEnvVars() {
    return REQUIRED_ENV_VARS.filter((envVar) => {
        const value = process.env[envVar];
        return typeof value !== "string" || value.trim().length === 0;
    });
}

async function seedSuperAdmin() {
    const missingEnvVars = getMissingEnvVars();
    if (missingEnvVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingEnvVars.join(", ")}`
        );
    }

    const mongoUri = getMongoUri();
    if (!mongoUri) {
        throw new Error(
            "Missing MongoDB URI. Set one of MONGODB_CLOUD_URI, MONGODB_URI, or DB_URI."
        );
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const existingSuperAdmin = await User.findOne({ role: "superAdmin" }).select("_id");
    if (existingSuperAdmin) {
        console.log("Super admin already exists. Skipping seed.");
        return;
    }

    const passwordHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 10);

    await User.create({
        firstName: process.env.SUPER_ADMIN_FIRST_NAME.trim(),
        lastName: process.env.SUPER_ADMIN_LAST_NAME.trim(),
        email: {
            address: process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase(),
            isVerified: true,
        },
        password: passwordHash,
        phone: {
            number: process.env.SUPER_ADMIN_PHONE.trim(),
            countryCode: process.env.SUPER_ADMIN_COUNTRY_CODE.trim(),
            isVerified: true,
        },
        role: "superAdmin",
        isBlocked: false,
    });

    console.log("Super admin created successfully.");
}

async function main() {
    try {
        await seedSuperAdmin();
        process.exitCode = 0;
    } catch (error) {
        console.error("Failed to seed super admin:", error.message);
        process.exitCode = 1;
    } finally {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
            console.log("MongoDB connection closed.");
        }
    }
}

main();
