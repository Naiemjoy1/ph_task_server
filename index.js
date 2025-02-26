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

    // User registration route
    app.post("/users", async (req, res) => {
      const { name, pin, nid, mobile, email, profileImage, userType } =
        req.body;

      // Check if user already exists
      const existingUser = await userCollection.findOne({
        $or: [{ mobile }, { email }],
      });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hash the PIN
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(pin.toString(), salt);

      // Set initial balance based on user type
      let initialBalance = 0;
      if (userType === "user") {
        initialBalance = 40;
      } else if (userType === "agent") {
        initialBalance = 100000;
      }

      // Create new user
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

    // Get all users (for testing purposes)
    app.get("/users", verifyToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // role api
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

    // Delete user route
    app.delete("/users/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //route to update user status
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

    //role change api
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

    // Login API
    app.post("/login", async (req, res) => {
      const { email, pin } = req.body;

      // Find user by email or mobile
      const user = await userCollection.findOne({
        $or: [{ email }, { mobile: email }],
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Compare hashed PIN
      const isMatch = await bcrypt.compare(pin.toString(), user.pin);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1h",
        }
      );
      // console.log("token", token);

      // Return token and user data
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

    // Send money route
    app.post("/send-money", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail;

      try {
        // Find sender and receiver
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

        // Find a single admin user
        const admin = await userCollection.findOne({ userType: "admin" });

        if (!sender || !receiver || !admin) {
          return res
            .status(404)
            .json({ message: "Receiver or admin not found" });
        }

        // Ensure sender and receiver are normal users
        if (sender.userType !== "user" || receiver.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Users can only send to other users" });
        }

        // Verify sender's PIN
        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        // Calculate transaction fee
        const fee = numericAmount > 100 ? 5 : 0;
        const totalAmount = numericAmount + fee;

        // Check sender's balance
        if (sender.balance < totalAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        // Perform the transaction
        const updatedSenderBalance = sender.balance - totalAmount;
        const updatedReceiverBalance = receiver.balance + numericAmount;
        const updatedAdminBalance = admin.balance + fee; // Add fee to admin's balance

        // Update sender balance
        await userCollection.updateOne(
          { _id: sender._id },
          { $set: { balance: updatedSenderBalance } }
        );

        // Update receiver balance
        await userCollection.updateOne(
          { _id: receiver._id },
          { $set: { balance: updatedReceiverBalance } }
        );

        // Update admin balance with the transaction fee
        if (fee > 0) {
          await userCollection.updateOne(
            { _id: admin._id },
            { $set: { balance: updatedAdminBalance } }
          );

          // Log transaction fee for admin
          await logTransaction(
            "transaction-fee",
            sender.email,
            admin.email,
            fee
          );
        }

        // Log the main transaction
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

    // Cash Out route
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

        // Calculate total fee (1.5% of the amount)
        const totalFee = numericAmount * 0.015;
        const adminFee = numericAmount * 0.005; // 0.5% to admin
        const agentFee = numericAmount * 0.01; // 1% to agent
        const netAmount = numericAmount - totalFee; // Amount user actually sends

        if (sender.balance < numericAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        // Update sender balance
        const updatedSenderBalance = sender.balance - numericAmount;

        // Update agent balance (receiver)
        const updatedReceiverBalance = receiver.balance + netAmount + agentFee;

        // Find the admin user
        const admin = await userCollection.findOne({ userType: "admin" });
        if (!admin) {
          return res.status(500).json({ message: "Admin account not found" });
        }

        // Update admin balance
        const updatedAdminBalance = admin.balance + adminFee;

        // Perform database updates in a single batch operation
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

        // Log transactions separately
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

    // Cash In route
    app.post("/cash-in", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        // Find sender's and receiver's information
        const sender = await userCollection.findOne({ email: senderEmail });
        let receiver;

        // Determine if receiverIdentifier is email or mobile
        if (receiverIdentifier.includes("@")) {
          receiver = await userCollection.findOne({
            email: receiverIdentifier,
          });
        } else {
          receiver = await userCollection.findOne({
            mobile: receiverIdentifier,
          });
        }

        // Check if sender and receiver exist
        if (!sender || !receiver) {
          return res.status(404).json({ message: "Receiver not found" });
        }

        // Check if the sender is an agent
        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can do cash-in" });
        }

        // Ensure the receiver is a user and not an agent
        if (receiver.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Agents can only send to users" });
        }

        // Verify sender's PIN
        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        // Check if sender has sufficient balance
        if (sender.balance < numericAmount) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        // Perform the transaction
        const updatedSenderBalance = parseFloat(sender.balance) - numericAmount;
        const updatedReceiverBalance =
          parseFloat(receiver.balance) + numericAmount;

        // Update balances in the database
        await userCollection.updateOne(
          { _id: sender._id },
          { $set: { balance: updatedSenderBalance } }
        );

        await userCollection.updateOne(
          { _id: receiver._id },
          { $set: { balance: updatedReceiverBalance } }
        );

        // Log the transaction
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

    // Cash-in request route
    app.post("/cash-in-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        // Find sender's information including user type
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        // Verify sender's user type
        if (sender.userType !== "user") {
          return res
            .status(403)
            .json({ message: "Only users can send cash-in requests" });
        }

        let receiver;

        // Determine if receiverIdentifier is email or mobile
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

        // Verify sender's PIN
        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        // // Check if sender has sufficient balance
        // if (sender.balance < numericAmount) {
        //   return res.status(400).json({ message: "Insufficient balance" });
        // }

        // Log the transaction
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

    // Cash request route (Agent to Admin)
    app.post("/cash-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        // Find sender's information including user type
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        // Verify sender's user type (Only agents can request cash)
        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can request cash" });
        }

        // Ensure receiver is an admin
        const receiver = await userCollection.findOne({
          email: receiverIdentifier,
          userType: "admin",
        });
        if (!receiver) {
          return res.status(404).json({ message: "Admin not found" });
        }

        // Verify sender's PIN
        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        // Log the transaction without charging any fee
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

    // withdraw-request route (Agent to Admin)
    app.post("/withdraw-request", verifyToken, async (req, res) => {
      const { receiverIdentifier, amount, pin } = req.body;
      const senderEmail = req.body.senderEmail; // Assuming sender's email is passed from frontend

      try {
        // Find sender's information including user type
        const sender = await userCollection.findOne({ email: senderEmail });

        if (!sender) {
          return res.status(404).json({ message: "Sender not found" });
        }

        // Verify sender's user type (Only agents can request cash)
        if (sender.userType !== "agent") {
          return res
            .status(403)
            .json({ message: "Only agents can request cash" });
        }

        // Ensure receiver is an admin
        const receiver = await userCollection.findOne({
          email: receiverIdentifier,
          userType: "admin",
        });
        if (!receiver) {
          return res.status(404).json({ message: "Admin not found" });
        }

        // Verify sender's PIN
        const isPinMatch = await bcrypt.compare(pin.toString(), sender.pin);
        if (!isPinMatch) {
          return res.status(401).json({ message: "Invalid PIN" });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ message: "Invalid amount" });
        }

        // Log the transaction without charging any fee
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
