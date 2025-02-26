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
      "https://mfs-ph.web.app",
      "https://mfs-ph.firebaseapp.com",
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

    app.post("/users", async (req, res) => {
      const { name, pin, nid, mobile, email, profileImage, userType } =
        req.body;

      const existingUser = await userCollection.findOne({
        $or: [{ mobile }, { email }],
      });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(pin.toString(), salt);

      let initialBalance = 0;
      if (userType === "user") {
        initialBalance = 40;
      } else if (userType === "agent") {
        initialBalance = 100000;
      }

      const newUser = {
        name,
        pin: hashedPin,
        mobile,
        nid,
        email,
        profileImage,
        userType,
        balance: initialBalance,
        status: "pending",
      };

      const result = await userCollection.insertOne(newUser);
      res.status(201).json(result);
    });

    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne(
        { email },
        { projection: { userType: 1, status: 1 } }
      );
      if (user) {
        res.json(user);
      } else {
        res.status(404).send("User not found");
      }
    });

    app.delete("/users/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.patch("/users/status/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { status } = req.body;

      try {
        const updatedUser = await userCollection.updateOne(
          { email },
          { $set: { status } }
        );

        if (updatedUser.modifiedCount > 0) {
          res.send({ modifiedCount: updatedUser.modifiedCount });
        } else {
          res
            .status(404)
            .send({ message: "User not found or status not updated" });
        }
      } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch("/users/admin/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { userType } = req.body;
      const updatedDoc = { $set: { userType } };

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          updatedDoc
        );

        if (result.modifiedCount > 0) {
          res.send({ modifiedCount: result.modifiedCount });
        } else {
          res
            .status(404)
            .send({ message: "User not found or role not updated" });
        }
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/login", async (req, res) => {
      const { email, pin } = req.body;

      const user = await userCollection.findOne({
        $or: [{ email }, { mobile: email }],
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isMatch = await bcrypt.compare(pin.toString(), user.pin);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { id: user._id, email: user.email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1h",
        }
      );
      res.json({
        message: "Login successful",
        token,
        user: {
          name: user.name,
          email: user.email,
          status: user.status,
          userType: user.userType,
          profileImage: user.profileImage,
        },
      });
    });

    app.post("/send-money", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail;

      try {
        const sender = await userCollection.findOne({ email: senderEmail });
        let receiver;

        if (receiverIdentifier.includes("@")) {
          receiver = await userCollection.findOne({
            email: receiverIdentifier,
          });
        } else {
          receiver = await userCollection.findOne({
            mobile: receiverIdentifier,
          });
        }

        const admin = await userCollection.findOne({ userType: "admin" });

        if (!sender || !receiver || !admin) {
          return res
            .status(404)
            .json({ message: "Receiver or admin not found" });
        }

        if (sender.userType !== "user" || receiver.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Users can only send to other users" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        const fee = numericAmount > 100 ? 5 : 0;
        const totalAmount = numericAmount + fee;

        if (sender.balance < totalAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        const updatedSenderBalance = sender.balance - totalAmount;
        const updatedReceiverBalance = receiver.balance + numericAmount;
        const updatedAdminBalance = admin.balance + fee; // Add fee to admin's balance

        await userCollection.updateOne(
          { _id: sender._id },
          { $set: { balance: updatedSenderBalance } }
        );

        await userCollection.updateOne(
          { _id: receiver._id },
          { $set: { balance: updatedReceiverBalance } }
        );

        if (fee > 0) {
          await userCollection.updateOne(
            { _id: admin._id },
            { $set: { balance: updatedAdminBalance } }
          );

          await logTransaction(
            "transaction-fee",
            sender.email,
            admin.email,
            fee
          );
        }

        await logTransaction(
          "send-money",
          sender.email,
          receiver.email,
          numericAmount
        );

        res.json({
          message: `Money sent successfully. Transaction fee of ${fee} added to admin balance.`,
          sender: sender.email,
          receiver: receiver.email,
        });
      } catch (error) {
        console.error("Error sending money:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/cash-out", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail;

      try {
        const sender = await userCollection.findOne({ email: senderEmail });
        let receiver;

        if (receiverIdentifier.includes("@")) {
          receiver = await userCollection.findOne({
            email: receiverIdentifier,
          });
        } else {
          receiver = await userCollection.findOne({
            mobile: receiverIdentifier,
          });
        }

        if (!sender || !receiver) {
          return res
            .status(404)
            .json({ message: "Sender or receiver not found" });
        }

        if (sender.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Only users can perform cash out" });
        }

        if (receiver.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Users can only send money to agents" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        const totalFee = numericAmount * 0.015;
        const adminFee = numericAmount * 0.005;
        const agentFee = numericAmount * 0.01;
        const netAmount = numericAmount - totalFee;

        if (sender.balance < numericAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        const updatedSenderBalance = sender.balance - numericAmount;

        const updatedReceiverBalance = receiver.balance + netAmount + agentFee;

        const admin = await userCollection.findOne({ userType: "admin" });
        if (!admin) {
          return res.status(500).json({ message: "Admin account not found" });
        }

        const updatedAdminBalance = admin.balance + adminFee;

        const bulkOperations = [
          {
            updateOne: {
              filter: { _id: sender._id },
              update: { $set: { balance: updatedSenderBalance } },
            },
          },
          {
            updateOne: {
              filter: { _id: receiver._id },
              update: { $set: { balance: updatedReceiverBalance } },
            },
          },
          {
            updateOne: {
              filter: { _id: admin._id },
              update: { $set: { balance: updatedAdminBalance } },
            },
          },
        ];

        await userCollection.bulkWrite(bulkOperations);

        await logTransaction(
          "cash-out",
          sender.email,
          receiver.email,
          numericAmount
        );
        await logTransaction("admin-fee", sender.email, admin.email, adminFee);
        await logTransaction(
          "agent-fee",
          sender.email,
          receiver.email,
          agentFee
        );

        res.json({
          message: "Cash Out successfully processed",
          sender: sender.email,
          receiver: receiver.email,
          fee: totalFee,
          adminFee,
          agentFee,
        });
      } catch (error) {
        console.error("Error processing cash-out:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/cash-in", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        const sender = await userCollection.findOne({ email: senderEmail });
        let receiver;

        if (receiverIdentifier.includes("@")) {
          receiver = await userCollection.findOne({
            email: receiverIdentifier,
          });
        } else {
          receiver = await userCollection.findOne({
            mobile: receiverIdentifier,
          });
        }

        if (!sender || !receiver) {
          return res.status(404).json({ message: "Receiver not found" });
        }

        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can do cash-in" });
        }

        if (receiver.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Agents can only send to users" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        if (sender.balance < numericAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        const updatedSenderBalance = parseFloat(sender.balance) - numericAmount;
        const updatedReceiverBalance =
          parseFloat(receiver.balance) + numericAmount;

        await userCollection.updateOne(
          { _id: sender._id },
          { $set: { balance: updatedSenderBalance } }
        );

        await userCollection.updateOne(
          { _id: receiver._id },
          { $set: { balance: updatedReceiverBalance } }
        );

        await logTransaction(
          "cash-in",
          sender.email,
          receiver.email,
          numericAmount
        );

        res.json({
          message: "Money sent successfully",
          sender: sender.email,
          receiver: receiver.email,
        });
      } catch (error) {
        console.error("Error sending money:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/cash-in-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        if (sender.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Only users can send cash-in requests" });
        }

        let receiver;

        if (receiverIdentifier.includes("@")) {
          receiver = await userCollection.findOne({
            email: receiverIdentifier,
          });
        } else {
          receiver = await userCollection.findOne({
            mobile: receiverIdentifier,
          });
        }

        if (!receiver) {
          return res.status(404).json({ message: "Receiver not found" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        await logTransaction(
          "cash-in",
          sender.email,
          receiverIdentifier,
          numericAmount,
          "pending"
        );

        res.json({
          message: "Money sent successfully",
          sender: sender.email,
          receiver: receiver.email,
        });
      } catch (error) {
        console.error("Error sending money:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/cash-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail;

      try {
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can request cash" });
        }

        const receiver = await userCollection.findOne({
          email: receiverIdentifier,
          userType: "admin",
        });
        if (!receiver) {
          return res.status(404).json({ message: "Admin not found" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        await logTransaction(
          "cash-request",
          sender.email,
          receiver.email,
          numericAmount,
          "pending"
        );

        res.json({
          message: "Cash request sent successfully",
          sender: sender.email,
          receiver: receiver.email,
        });
      } catch (error) {
        console.error("Error processing cash request:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/withdraw-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail;

      try {
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can request cash" });
        }

        const receiver = await userCollection.findOne({
          email: receiverIdentifier,
          userType: "admin",
        });
        if (!receiver) {
          return res.status(404).json({ message: "Admin not found" });
        }

        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        await logTransaction(
          "withdraw-request",
          sender.email,
          receiver.email,
          numericAmount,
          "pending"
        );

        res.json({
          message: "Cash request sent successfully",
          sender: sender.email,
          receiver: receiver.email,
        });
      } catch (error) {
        console.error("Error processing cash request:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post(
      "/cash-out-request",
      verifyToken,

      async (req, res) => {
        const { receiverIdentifier, amount, pin } = req.body;
        const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

        try {
          const sender = await userCollection.findOne({ email: senderEmail });

          if (!sender) {
            return res.status(404).json({ message: "Sender not found" });
          }

          if (sender.userType !== "agent") {
            return res
              .status(403)
              .json({ message: "Only agent can send cash-out requests" });
          }

          let receiver;

          if (receiverIdentifier.includes("@")) {
            receiver = await userCollection.findOne({
              email: receiverIdentifier,
            });
          } else {
            receiver = await userCollection.findOne({
              mobile: receiverIdentifier,
            });
          }

          if (!receiver) {
            return res.status(404).json({ message: "Receiver not found" });
          }

          const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
          if (!isPinMatch) {
            return res.status(401).json({ message: "Invalid PIN" });
          }

          const numericAmount = parseFloat(amount);
          if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
          }

          if (sender.balance < numericAmount) {
            return res.status(400).json({ message: "Insufficient balance" });
          }

          await logTransaction(
            "cash-out",
            sender.email,
            receiverIdentifier,
            numericAmount,
            "pending"
          );

          res.json({
            message: "Money sent successfully",
            sender: sender.email,
            receiver: receiver.email,
          });
        } catch (error) {
          console.error("Error sending money:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    app.get("/history", async (req, res) => {
      const result = await transactionCollection.find().toArray();
      res.send(result);
    });

    app.get("/history/transfers", async (req, res) => {
      try {
        const result = await transactionCollection
          .aggregate([
            {
              $group: {
                _id: "$type",
                total: { $sum: "$amount" },
              },
            },
          ])
          .toArray();

        const totals = {
          cashIn: 0,
          cashOut: 0,
          sendMoney: 0,
        };

        result.forEach((item) => {
          if (item._id === "cash-in") {
            totals.cashIn = item.total;
          } else if (item._id === "cash-out") {
            totals.cashOut = item.total;
          } else if (item._id === "send-money") {
            totals.sendMoney = item.total;
          }
        });

        totals.grandTotal = totals.cashIn + totals.cashOut + totals.sendMoney;

        res.send(totals);
      } catch (error) {
        console.error("Error getting total amounts:", error);
        res.status(500).send({ message: "An error occurred", error });
      }
    });

    app.get("/history/:email", async (req, res) => {
      const { email } = req.params;

      try {
        const transactions = await transactionCollection
          .find({
            $or: [{ sender: email }, { receiver: email }],
          })
          .toArray();

        const result = {
          cashIn: 0,
          cashOut: 0,
          sendMoney: 0,
          other: 0,
        };

        transactions.forEach((transaction) => {
          switch (transaction.type) {
            case "cash-in":
              result.cashIn += transaction.amount;
              break;
            case "cash-out":
              result.cashOut += transaction.amount;
              break;
            case "send-money":
              result.sendMoney += transaction.amount;
              break;
            default:
              result.other += transaction.amount;
              break;
          }
        });

        res.json(result);
      } catch (error) {
        console.error("Error fetching transaction history:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.get("/history/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const test = await transactionCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(test);
    });

    app.delete("/history/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await transactionCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.json({ message: "Transaction request declined successfully" });
        } else {
          res.status(404).json({ message: "Transaction not found" });
        }
      } catch (error) {
        console.error("Error deleting transaction log:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    const { ObjectId } = require("mongodb");

    app.patch("/history/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      try {
        const transaction = await transactionCollection.findOne({
          _id: new ObjectId(id),
          status: "pending",
        });

        if (!transaction) {
          return res
            .status(404)
            .send({ message: "Transaction not found or already confirmed" });
        }

        const { sender, receiver, amount, type } = transaction;

        const senderUser = await userCollection.findOne({ email: sender });
        const receiverUser = await userCollection.findOne({ email: receiver });

        if (!senderUser || !receiverUser) {
          return res
            .status(404)
            .send({ message: "Sender or receiver not found" });
        }

        if (type === "cash-request") {
          if (receiverUser.balance < amount) {
            return res
              .status(400)
              .send({ message: "Receiver has insufficient balance" });
          }

          await userCollection.updateOne(
            { email: sender },
            { $inc: { balance: amount } }
          );
          await userCollection.updateOne(
            { email: receiver },
            { $inc: { balance: -amount } }
          );
        } else if (type === "withdraw-request") {
          if (senderUser.balance < amount) {
            return res
              .status(400)
              .send({ message: "Sender has insufficient balance" });
          }

          await userCollection.updateOne(
            { email: sender },
            { $inc: { balance: -amount } }
          );
          await userCollection.updateOne(
            { email: receiver },
            { $inc: { balance: amount } }
          );
        }

        const result = await transactionCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          { $set: { status: "confirm" } }
        );

        if (result.modifiedCount > 0) {
          res.send({ message: "Transaction confirmed successfully" });
        } else {
          res
            .status(404)
            .send({ message: "Transaction not found or already confirmed" });
        }
      } catch (error) {
        console.error("Error updating transaction:", error);
        res.status(500).send({ message: "An error occurred", error });
      }
    });

    app.get("/income", verifyToken, async (req, res) => {
      try {
        const result = await transactionCollection
          .aggregate([
            {
              $match: {
                type: { $in: ["transaction-fee", "admin-fee", "agent-fee"] },
              },
            },
            {
              $group: {
                _id: "$receiver",
                totalAmount: { $sum: "$amount" },
              },
            },
            {
              $project: {
                _id: 0,
                receiver: "$_id",
                totalAmount: 1,
              },
            },
          ])
          .toArray();

        res.json(result);
      } catch (error) {
        console.error("Error fetching income data:", error);
        res.status(500).json({ message: "An error occurred", error });
      }
    });

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
