const express = require("express");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://mfs-ph.web.app/",
      "https://mfs-ph.firebaseapp.com/",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ccm0dfs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const userCollection = client.db("mfsDB").collection("users");
    const transactionCollection = client.db("mfsDB").collection("transactions");

    //log api
    const logTransaction = async (type, sender, receiver, amount, status) => {
      const transaction = {
        type,
        sender,
        receiver,
        amount,
        status,
        timestamp: new Date(),
      };
      await transactionCollection.insertOne(transaction);
    };

    // Middleware
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Forbidden access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    console.log("Connected to MongoDB successfully!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("MFS server running");
});

app.listen(port, () => {
  console.log(`MFS running on port ${port}`);
});
