require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const SSLCommerzPayment = require('sslcommerz-lts')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3aom8f0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = true //true for live, false for sandbox

async function run() {
    try {
        await client.connect();

        const userCollection = client.db('gadgetDB').collection('users');
        const productCollection = client.db('gadgetDB').collection('products');
        const orderCollection = client.db('gadgetDB').collection('orders');
        const cartCollection = client.db('gadgetDB').collection('carts');

        // Generate JWT Token
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '24h'
            });
            res.send({ token });
        });

        // Middleware to Verify JWT Token
        const verifyToken = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'Unauthorized Access' });
            }
            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(403).send({ message: 'Forbidden Access' });
                }
                req.user = decoded;
                next();
            });
        };

        // Get all products
        app.get('/product', async (req, res) => {
            const result = await productCollection.find().toArray();
            res.send(result);
        });

        // Add a new product
        app.post('/product', async (req, res) => {
            const productItem = req.body;
            const result = await productCollection.insertOne(productItem);
            res.send(result);
        });

        // Get a specific product by ID
        app.get('/product/:id', async (req, res) => {
            const id = req.params.id;
            try {
                if (ObjectId.isValid(id)) {
                    const query = { _id: new ObjectId(id) };
                    const result = await productCollection.findOne(query);
                    if (result) {
                        res.send(result);
                    } else {
                        res.status(404).send({ error: 'Product not found' });
                    }
                } else {
                    res.status(400).send({ error: 'Invalid ID format' });
                }
            } catch (error) {
                res.status(500).send({ error: 'Internal Server Error' });
            }
        });

        // // delete 
        // app.delete('product/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const query = { _id: new ObjectId(id) };
        //     const result = await productCollection.deleteOne(query);
        //     res.send(result);
        // })
        // delete product by id
        app.delete('/product/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const query = { _id: new ObjectId(id) };
                const result = await productCollection.deleteOne(query);

                if (result.deletedCount === 1) {
                    res.status(200).json({ message: 'Product deleted successfully.' });
                } else {
                    res.status(404).json({ message: 'Product not found.' });
                }
            } catch (error) {
                console.error('Error deleting product:', error);
                res.status(500).json({ message: 'Internal server error.' });
            }
        });

        // update product
        app.patch('/product/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updates = req.body;
                const query = { _id: new ObjectId(id) };

                // Update the product in the database
                const result = await productCollection.updateOne(query, { $set: updates });

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'Product not found' });
                }
                res.send(result);
            } catch (error) {
                console.error("Error updating product:", error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });


        // Add a new user
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await userCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'User Already Created', insertedId: null });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        // Get all users
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // Get all cart items for a specific user
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        // Add a new cart item
        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });

        // Delete a cart item by ID
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });


        // const tran_id = new ObjectId().toString()
        // payment---------------------------------
        app.post('/order', async (req, res) => {
            const { email, name, address, postcode, currency } = req.body;

            try {
                // Fetch the user's cart items from the database
                const cartItems = await cartCollection.find({ email }).toArray();

                if (!cartItems || cartItems.length === 0) {
                    return res.status(400).send({ message: 'Cart is empty' });
                }

                // Calculate the total amount from the cart items
                const totalAmount = parseFloat(cartItems.reduce((total, item) => {
                    const price = parseFloat(item.price);

                    // Log invalid prices for debugging
                    if (isNaN(price)) {
                        console.error('Invalid price:', item);
                        return total; // Skip this item if price is invalid
                    }

                    return total + price;
                }, 0));

                // Check if totalAmount is NaN
                if (isNaN(totalAmount)) {
                    return res.status(500).send({ message: 'Error calculating total amount' });
                }

                const tran_id = "tran" + new Date().getTime();
                const data = {
                    total_amount: totalAmount,
                    currency: currency,
                    tran_id: tran_id,
                    success_url: `https://gadget-home-server2.onrender.com/success/${tran_id}`,
                    fail_url: `https://gadget-home-server2.onrender.com/payment/fail/${tran_id}`,
                    cancel_url: 'http://localhost:3030/cancel',
                    ipn_url: 'http://localhost:3030/ipn',
                    shipping_method: 'Courier',
                    product_name: 'Cart Items',
                    product_category: 'Electronic',
                    product_profile: 'general',
                    cus_name: name,
                    cus_email: email,
                    cus_add1: address,
                    cus_add2: address,
                    cus_city: address,
                    cus_state: address,
                    cus_postcode: postcode,
                    cus_country: 'Bangladesh',
                    cus_phone: '01711111111',
                    cus_fax: '01711111111',
                    ship_name: name,
                    ship_add1: address,
                    ship_add2: address,
                    ship_city: address,
                    ship_state: address,
                    ship_postcode: postcode,
                    ship_country: 'Bangladesh',
                };

                console.log(data);

                // Initialize SSLCommerz Payment
                const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
                const apiResponse = await sslcz.init(data);
                const GatewayPageURL = apiResponse.GatewayPageURL;
                res.send({ url: GatewayPageURL });

                const finalOrder = {
                    email,
                    cartItems,
                    paidStatus: false,
                    transectionId: tran_id,
                };

                // Await the result of the insertOne operation
                const result = await orderCollection.insertOne(finalOrder);
                console.log('Order inserted:', result);

                console.log('Redirecting to: ', GatewayPageURL);
            } catch (error) {
                console.error('Error processing order:', error);
                res.status(500).json({ message: 'Internal Server Error' });
            }
        });

        app.post('/payment/success/:tranID', async (req, res) => {
            const { tranID } = req.params;

            const result = await orderCollection.updateOne(
                { transectionId: tranID },
                { $set: { paidStatus: true } }
            );
            if (result.modifiedCount > 0) {
                res.redirect(`http://localhost:5173/payment/success/${tranID}`);
            }
        });

        app.get('/order', async (req, res) => {
            const result = await orderCollection.find().toArray();
            res.send(result);
        });


        app.post('/payment/fail/:tranId', async (req, res) => {
            try {
                // Delete the order with the specified transaction ID
                const result = await orderCollection.deleteOne({ transectionId: req.params.tranId });
        
                // If the deletion is successful, redirect to the fail page with the transaction ID
                if (result.deletedCount > 0) {
                    res.redirect(`http://localhost:5173/payment/fail/${req.params.tranId}`);
                } else {
                    // Handle the case where the order was not found
                    res.status(404).send('Order not found');
                }
            } catch (error) {
                console.error('Error handling failed payment:', error);
                res.status(500).send('Internal Server Error');
            }
        });
        



       



























        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Optionally close the client connection
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Gadget Home is Running');
});

app.listen(port, () => {
    console.log(`Gadget Home is Running on Port: ${port}`);
});
