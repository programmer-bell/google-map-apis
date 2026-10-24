const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

const router = express.Router();
dotenv.config();

// places API - text search 
router.get("/places/search", async(req, res) => {
    try{
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({
                success: false,
                message: "Query parameter is required"   
            })

            const response = await fetch(
                'https://places.googleapis.com/v1/places:searchText',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                        'X_Goog-FieldMask': 'places.id, places.displayName, places.formattedAddress, places.priceLevel'
                    },
                    body: JSON.stringify({
                        textQuery: query
                    })
                }
            )
        }
        const data = await response.json();

        if(!response.ok) {
            return res.status(500).json({
                success: false,
                message: data   
            })
        }

        const places = data.places || [];
        const formattedPlaces = places.map((place) => ({
            id: place.id,
            name: place.displayName?.text,
            address: place.formattedPlaces,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude,
        }));

        return res.status(200).json({
            success: true,
            count: formattedPlaces.length,
            message: formattedPlaces   
        })
    }catch(err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});

module.exports = router;