function TwoDigits(val){
    if (val < 10){
         return "0" + val;
    }
    
    return val;
}

$("#slider").dateRangeSlider({
    bounds: {min: new Date(2013, 0, 1), max: new Date(2013, 0, 1, 23, 59, 59)},
    defaultValues: {min: new Date(2013, 0, 1, 8), max: new Date(2013, 0, 1, 18)},
    formatter: function(value){
        var hours = value.getHours(),
            minutes = value.getMinutes();
        return TwoDigits(hours) + ":" + TwoDigits(minutes);
    }
});
